import fs from 'fs';
import { bbox } from '@turf/turf';
import booleanIntersects from '@turf/boolean-intersects';
import path from 'path';
import { Logger } from './logger.js';
import { PriorityQueue } from './priorityQueue.js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { Database } from './database.js';

// Sleep helper function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class TMSScraper {
    constructor() {
        this.minZoom = 10;
        this.maxZoom = parseInt(process.env.ZOOM_LEVEL || '16');
        this.geojsonPath = 'data/austria.geojson';
        this.austriaData = null;
        this.priorityQueue = new PriorityQueue();
        this.settings = {
            batchSize: 1000,
            minQueueSize: 100,
            maxTilesToProcess: 0,
            updateInterval: 24,
            maxConcurrent: 5,
            minZoom: 10,
            maxZoom: 16,
            zoomLevels: [],
            requestDelay: 500  // Default delay of 500ms between requests
        };
        
        if (isNaN(this.maxZoom)) {
            throw new Error('Invalid ZOOM_LEVEL environment variable');
        }

        // Initialize database with PostgreSQL configuration
        this.db = new Database({
            type: 'postgres',
            user: process.env.POSTGRES_USER || 'postgres',
            host: process.env.POSTGRES_HOST || 'localhost',
            database: process.env.POSTGRES_DB || 'tmss',
            password: process.env.POSTGRES_PASSWORD || 'postgres',
            port: parseInt(process.env.POSTGRES_PORT || '5432')
        });
    }

    async init() {
        // Initialize database
        await this.db.init();

        // Initialize logger after database is ready
        this.logger = new Logger('init');

        await this.logger.info('Starting scraper', {
            minZoom: this.minZoom,
            maxZoom: this.maxZoom,
            dbPath: this.dbPath
        });

        // Load Austria GeoJSON
        await this.logger.info('Loading Austria GeoJSON...');
        this.austriaData = JSON.parse(fs.readFileSync(this.geojsonPath, 'utf8'));

        // Load settings from database
        const dbSettings = await this.db.getSettings();
        this.settings = { ...this.settings, ...dbSettings };
    }

    async close() {
        if (this.db) {
            await this.db.close();
        }
    }

    // Convert lat/lon to tile coordinates
    latLonToTile(lat, lon, zoom) {
        const n = Math.pow(2, zoom);
        const xtile = Math.floor((lon + 180) / 360 * n);
        const ytile = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        return { x: xtile, y: ytile };
    }

    // Convert tile coordinates to lat/lon
    tileToLatLon(x, y, zoom) {
        const n = Math.pow(2, zoom);
        const lon = x / n * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
        return { lat, lon };
    }

    // Get bounding box of a tile
    getTileBounds(x, y, zoom) {
        const nw = this.tileToLatLon(x, y, zoom);
        const se = this.tileToLatLon(x + 1, y + 1, zoom);
        return {
            minX: nw.lon,
            minY: se.lat,
            maxX: se.lon,
            maxY: nw.lat
        };
    }

    // Check if a tile intersects with Austria
    async tileIntersectsAustria(x, y, zoom) {
        const bounds = this.getTileBounds(x, y, zoom);
        
        // Create a simple rectangle polygon for the tile
        const tilePolygon = {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [bounds.minX, bounds.minY],
                    [bounds.maxX, bounds.minY],
                    [bounds.maxX, bounds.maxY],
                    [bounds.minX, bounds.maxY],
                    [bounds.minX, bounds.minY]
                ]]
            }
        };

        // Check if the tile polygon intersects with any part of Austria
        for (const feature of this.austriaData.features) {
            if (booleanIntersects(feature, tilePolygon)) {
                return true;
            }
        }
        return false;
    }

    async generateTiles() {
        const bounds = bbox(this.austriaData);
                
        await this.logger.info(`Starting with zoom level ${this.minZoom}`);
        await this.generateTilesForZoom(this.minZoom, bounds);
        
        for (let zoom = this.minZoom + 1; zoom <= this.maxZoom; zoom++) {
            await this.logger.info(`Processing zoom level ${zoom}`);
            const parentTiles = await this.db.getTilesByZoom(zoom - 1);

            await this.logger.info(`Total tiles to check: ${parentTiles.length*4}`);
            let tileBatch = [];
            let tilesFound = 0;

            try {
                for (const parentTile of parentTiles) {
                    const childX = parentTile.x * 2;
                    const childY = parentTile.y * 2;
                    
                    for (let dx = 0; dx < 2; dx++) {
                        for (let dy = 0; dy < 2; dy++) {
                            const x = childX + dx;
                            const y = childY + dy;
                            
                            if (await this.tileIntersectsAustria(x, y, zoom)) {
                                tileBatch.push([x, y, zoom, parentTile.x, parentTile.y, parentTile.z]);
                                tilesFound++;

                                // Insert in batches of 5000
                                if (tileBatch.length >= 5000) {
                                    await this.batchInsertTiles(tileBatch);
                                    await this.logger.info(`Inserted ${tilesFound} tiles...`);
                                    tileBatch = [];
                                }
                            }
                        }
                    }
                }

                // Insert any remaining tiles
                if (tileBatch.length > 0) {
                    await this.batchInsertTiles(tileBatch);
                    await this.logger.info(`Inserted ${tilesFound} tiles...`);
                }
                
            } catch (error) {
                await this.logger.error(`Error processing zoom level ${zoom}:`, { error: error.message });
                throw error;
            }
            
            const tileCount = await this.db.get(
                'SELECT COUNT(*) as count FROM tiles WHERE z = $1',
                [zoom]
            );
            await this.logger.info(`Found ${tileCount.count} tiles at zoom level ${zoom}`);
        }
    }

    async batchInsertTiles(tiles) {
        if (tiles.length === 0) return;

        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            for (const tile of tiles) {
                await client.query(
                    'INSERT INTO tiles (x, y, z, parent_x, parent_y, parent_z) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (x, y, z) DO NOTHING',
                    tile
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async generateTilesForZoom(zoom, bounds) {
        const minTile = this.latLonToTile(bounds[1], bounds[0], zoom);
        const maxTile = this.latLonToTile(bounds[3], bounds[2], zoom);
        
        const minX = Math.min(minTile.x, maxTile.x);
        const maxX = Math.max(minTile.x, maxTile.x);
        const minY = Math.min(minTile.y, maxTile.y);
        const maxY = Math.max(minTile.y, maxTile.y);
        
        await this.logger.info(`Generating tiles from ${minX},${minY} to ${maxX},${maxY}`);
        await this.logger.info(`Total tiles to check: ${(maxX - minX + 1) * (maxY - minY + 1)}`);
        
        let tilesFound = 0;
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const intersects = await this.tileIntersectsAustria(x, y, zoom);
                    if (intersects) {
                        await client.query(
                            'INSERT INTO tiles (x, y, z, parent_x, parent_y, parent_z) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (x, y, z) DO NOTHING',
                            [x, y, zoom, null, null, null]
                        );
                        tilesFound++;
                        if (tilesFound % 1000 === 0) {
                            await client.query('COMMIT');
                            await client.query('BEGIN');
                            await this.logger.info(`Found ${tilesFound} intersecting tiles so far...`);
                        }
                    }
                }
            }
            await client.query('COMMIT');
        } catch (error) {
            await this.logger.error('Error during initial tile generation:', { error: error.message });
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
        await this.logger.info(`Total tiles found: ${tilesFound}`);
    }

    async fetchPbfTile(x, y, z) {
        const url = 'https://kataster.bev.gv.at/tiles/kataster/{z}/{x}/{y}.pbf'
            .replace('{x}', x)
            .replace('{y}', y)
            .replace('{z}', z);

        try {
            await this.logger.info('Fetching PBF tile', { url, x, y, z });
            const response = await fetch(url);
            
            if (!response.ok) {
                await this.logger.error('Failed to fetch PBF tile', { 
                    status: response.status,
                    statusText: response.statusText,
                    x, y, z 
                });
                return null;
            }

            const buffer = await response.arrayBuffer();
            await this.logger.info('Successfully fetched PBF tile', { 
                size: buffer.byteLength,
                x, y, z 
            });
            
            return Buffer.from(buffer);
        } catch (error) {
            await this.logger.error('Error fetching PBF tile', { 
                error: error.message,
                x, y, z 
            });
            return null;
        }
    }

    async getPbfHash(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    async loadTilesIntoQueue() {
        // Log settings before building query
        console.log('Current settings:', {
            zoomLevels: this.settings.zoomLevels,
            minZoom: this.settings.minZoom,
            maxZoom: this.settings.maxZoom,
            updateInterval: this.settings.updateInterval,
            batchSize: this.settings.batchSize
        });

        // Always use maxZoom if no specific zoom level is set
        const zoomLevel = this.settings.zoomLevels?.[0] || this.settings.maxZoom;
        console.log('Using zoom level:', zoomLevel);

        // Get tiles that need updating, ordered by priority
        const query = `
            SELECT 
                t.x, t.y, t.z,
                p.last_modified,
                p.hash
            FROM tiles t
            LEFT JOIN pbf_tiles p ON t.x = p.x AND t.y = p.y AND t.z = p.z
            WHERE (p.last_modified IS NULL 
               OR p.last_modified < NOW() - interval '${this.settings.updateInterval} hours')
            AND t.z = $1
            ORDER BY 
                COALESCE(p.last_modified, '1970-01-01'::timestamp) ASC  -- Older tiles first
            LIMIT ${this.settings.batchSize}
        `;

        const params = [zoomLevel];

        console.log('Executing query:', {
            query,
            params,
            zoomLevel
        });

        try {
            const result = await this.db.run(query, params);
            if (!result || !result.rows) {
                console.error('No result or rows from query:', { result });
                return;
            }

            const tiles = result.rows;
            console.log(`Query returned ${tiles.length} tiles`);

            await this.logger.info('Loading tiles into priority queue', { 
                count: tiles.length,
                settings: this.settings,
                zoomLevel,
                params,
                query
            });

            for (const tile of tiles) {
                // Calculate priority based on:
                // 1. Age (older = more important)
                // 2. Whether it's never been fetched (highest priority)
                const age = tile.last_modified ? 
                    (new Date() - new Date(tile.last_modified).getTime()) / (1000 * 60 * 60) : // hours
                    Infinity;
                
                const priority = (age * 100) +       // Age weight
                               (tile.last_modified ? 0 : 10000); // Never fetched bonus

                this.priorityQueue.enqueue(tile, priority);
            }

            await this.logger.info('Priority queue loaded', {
                queueSize: this.priorityQueue.size(),
                zoomLevel
            });
        } catch (error) {
            console.error('Error executing query:', error);
            await this.logger.error('Failed to load tiles into queue', {
                error: error.message,
                query,
                params
            });
            throw error;
        }
    }

    async scrapePbfTiles() {
        this.logger = new Logger('pbf_scraper');
        const startTime = new Date();
        await this.logger.info('Starting PBF tile scraping', { settings: this.settings });

        // Load initial batch of tiles into queue
        await this.loadTilesIntoQueue();
        
        let processed = 0;
        let updated = 0;
        let errors = 0;
        let currentZoom = null;

        while (!this.priorityQueue.isEmpty()) {
            // Check if we've reached the maximum tiles to process
            if (this.settings.maxTilesToProcess > 0 && processed >= this.settings.maxTilesToProcess) {
                await this.logger.info('Reached maximum tiles to process', {
                    processed,
                    maxTiles: this.settings.maxTilesToProcess
                });
                break;
            }

            const { tile } = this.priorityQueue.dequeue();
            
            try {
                // Log zoom level changes
                if (currentZoom !== tile.z) {
                    currentZoom = tile.z;
                    await this.logger.info('Processing new zoom level', { 
                        zoom: currentZoom,
                        processed,
                        updated,
                        errors,
                        queueSize: this.priorityQueue.size(),
                        settings: this.settings
                    });
                }

                // Add delay between requests
                await sleep(this.settings.requestDelay);

                const pbfData = await this.fetchPbfTile(tile.x, tile.y, tile.z);
                if (!pbfData) {
                    errors++;
                    continue;
                }

                const newHash = await this.getPbfHash(pbfData);

                // Only update if the tile is new or different
                if (!tile.hash || tile.hash !== newHash) {
                    const client = await this.db.connect();
                    try {
                        await client.query('BEGIN');
                        await this.logger.info('Updating tile', { 
                            x: tile.x, 
                            y: tile.y, 
                            z: tile.z,
                            isNew: !tile.hash,
                            oldHash: tile.hash,
                            newHash
                        });

                        // Only insert into history if there's an existing version
                        if (tile.hash) {
                            await client.query(
                                'INSERT INTO pbf_tiles_history (x, y, z, data, hash) VALUES ($1, $2, $3, $4, $5)',
                                [tile.x, tile.y, tile.z, pbfData, newHash]
                            );
                        }

                        // Update current version
                        await client.query(
                            'INSERT INTO pbf_tiles (x, y, z, data, hash, last_modified) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) ON CONFLICT (x, y, z) DO UPDATE SET data = EXCLUDED.data, hash = EXCLUDED.hash, last_modified = CURRENT_TIMESTAMP',
                            [tile.x, tile.y, tile.z, pbfData, newHash]
                        );

                        await client.query('COMMIT');
                        updated++;
                    } catch (error) {
                        await client.query('ROLLBACK');
                        await this.logger.error('Failed to update tile', {
                            error: error.message,
                            x: tile.x,
                            y: tile.y,
                            z: tile.z
                        });
                        throw error;
                    } finally {
                        client.release();
                    }
                }

                processed++;
                
                // Update stats through callback if available
                if (this.onStatsUpdate) {
                    await this.onStatsUpdate(processed, updated);
                }

                if (processed % 100 === 0) {
                    await this.logger.info('Scraping progress', {
                        processed,
                        updated,
                        errors,
                        queueSize: this.priorityQueue.size(),
                        zoom: tile.z,
                        percentComplete: ((processed / (processed + this.priorityQueue.size())) * 100).toFixed(2),
                        settings: this.settings
                    });

                    // Load more tiles if queue is getting low
                    if (this.priorityQueue.size() < this.settings.minQueueSize) {
                        await this.loadTilesIntoQueue();
                    }
                }

            } catch (error) {
                errors++;
                await this.logger.error('Error processing PBF tile:', {
                    error: error.message,
                    tile,
                    processed,
                    updated,
                    errors
                });
            }
        }

        // Final stats update
        if (this.onStatsUpdate) {
            await this.onStatsUpdate(processed, updated);
        }

        // Get statistics
        const stats = await this.db.get(`
            SELECT 
                (SELECT COUNT(*) FROM pbf_tiles) as current_tiles,
                (SELECT COUNT(*) FROM pbf_tiles_history) as total_versions
        `);

        const endTime = new Date();
        const duration = (endTime - startTime) / 1000; // Convert to seconds
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = Math.floor(duration % 60);

        await this.logger.info('PBF scraping completed', {
            totalProcessed: processed,
            totalUpdated: updated,
            totalErrors: errors,
            currentTiles: stats.current_tiles,
            totalVersions: stats.total_versions,
            successRate: ((processed - errors) / processed * 100).toFixed(2),
            duration: {
                total: duration.toFixed(2) + ' seconds',
                formatted: `${hours}h ${minutes}m ${seconds}s`,
            },
            settings: this.settings
        });
    }
}