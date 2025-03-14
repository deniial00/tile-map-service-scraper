import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { bbox } from '@turf/turf';
import booleanIntersects from '@turf/boolean-intersects';
import path from 'path';
import { Logger } from './logger.js';
import { PriorityQueue } from './priorityQueue.js';
import fetch from 'node-fetch';
import crypto from 'crypto';

// Sleep helper function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class TMSScraper {
    constructor() {
        this.minZoom = 10;
        this.maxZoom = parseInt(process.env.ZOOM_LEVEL || '16');
        this.dbPath = '/data/tiles.db';
        this.geojsonPath = '/data/austria.geojson';
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
    }

    async init() {
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Initialize SQLite database first
        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        // Enable WAL mode and other optimizations
        await this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -64000; -- 64MB cache

            -- Remove logs table if it exists
            DROP TABLE IF EXISTS logs;
        `);

        // Create tiles table if it doesn't exist
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS tiles (
                x INTEGER,
                y INTEGER,
                z INTEGER,
                parent_x INTEGER,
                parent_y INTEGER,
                parent_z INTEGER,
                PRIMARY KEY (x, y, z)
            )
        `);

        // Create PBF tiles table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS pbf_tiles (
                x INTEGER,
                y INTEGER,
                z INTEGER,
                data BLOB,
                hash TEXT,
                last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (x, y, z)
            )
        `);

        // Create PBF history table - simplified schema
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS pbf_tiles_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                x INTEGER,
                y INTEGER,
                z INTEGER,
                data BLOB,
                hash TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create settings table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add indices for faster queries
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_pbf_modified 
            ON pbf_tiles(last_modified);
            
            CREATE INDEX IF NOT EXISTS idx_history_coords 
            ON pbf_tiles_history(x, y, z);
            
            CREATE INDEX IF NOT EXISTS idx_history_date 
            ON pbf_tiles_history(created_at);
        `);

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

        // Prepare statements
        this.insertTileStmt = await this.db.prepare(`
            INSERT OR IGNORE INTO tiles (x, y, z, parent_x, parent_y, parent_z)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        this.insertPbfStmt = await this.db.prepare(`
            INSERT OR REPLACE INTO pbf_tiles (x, y, z, data, hash, last_modified)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        this.insertHistoryStmt = await this.db.prepare(`
            INSERT INTO pbf_tiles_history (x, y, z, data, hash)
            VALUES (?, ?, ?, ?, ?)
        `);
    }

    async close() {
        if (this.db) {
            try {
                // Finalize prepared statement before closing
                if (this.insertTileStmt) {
                    await this.insertTileStmt.finalize();
                }
                await this.db.close();
            } catch (error) {
                await this.logger.error('Error during cleanup:', { error: error.message });
            }
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
            const parentTiles = await this.db.all(
                'SELECT x, y, z FROM tiles WHERE z = ?',
                [zoom - 1]
            );

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
                'SELECT COUNT(*) as count FROM tiles WHERE z = ?',
                [zoom]
            );
            await this.logger.info(`Found ${tileCount.count} tiles at zoom level ${zoom}`);
        }
    }

    async batchInsertTiles(tiles) {
        if (tiles.length === 0) return;

        const placeholders = tiles.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
        const values = tiles.flat();

        await this.db.exec('BEGIN TRANSACTION');
        try {
            await this.db.run(`
                INSERT OR IGNORE INTO tiles (x, y, z, parent_x, parent_y, parent_z)
                VALUES ${placeholders}
            `, values);
            await this.db.exec('COMMIT');
        } catch (error) {
            await this.db.exec('ROLLBACK');
            throw error;
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
        await this.db.exec('BEGIN TRANSACTION');
        try {
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const intersects = await this.tileIntersectsAustria(x, y, zoom);
                    if (intersects) {
                        await this.insertTileStmt.run([x, y, zoom, null, null, null]);
                        tilesFound++;
                        if (tilesFound % 1000 === 0) {
                            await this.db.exec('COMMIT');
                            await this.db.exec('BEGIN TRANSACTION');
                            await this.logger.info(`Found ${tilesFound} intersecting tiles so far...`);
                        }
                    }
                }
            }
            await this.db.exec('COMMIT');
        } catch (error) {
            await this.logger.error('Error during initial tile generation:', { error: error.message });
            await this.db.exec('ROLLBACK');
            throw error;
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
        // Build zoom level condition
        let zoomCondition = '';
        let params = [`-${this.settings.updateInterval} hours`, this.settings.batchSize];
        
        if (this.settings.zoomLevels && this.settings.zoomLevels.length > 0) {
            // If specific zoom levels are specified, only use those
            zoomCondition = 'AND t.z IN (' + this.settings.zoomLevels.join(',') + ')';
        } else {
            // Otherwise use the min/max zoom range
            zoomCondition = 'AND t.z BETWEEN ? AND ?';
            params = [
                `-${this.settings.updateInterval} hours`,
                this.settings.minZoom,
                this.settings.maxZoom,
                this.settings.batchSize
            ];
        }

        // Get tiles that need updating, ordered by priority
        const tiles = await this.db.all(`
            SELECT 
                t.x, t.y, t.z,
                p.last_modified,
                p.hash
            FROM tiles t
            LEFT JOIN pbf_tiles p ON t.x = p.x AND t.y = p.y AND t.z = p.z
            WHERE (p.last_modified IS NULL 
               OR p.last_modified < datetime('now', ?))
            ${zoomCondition}
            ORDER BY 
                t.z DESC,  -- Higher zoom levels first
                COALESCE(p.last_modified, '1970-01-01') ASC  -- Older tiles first
            LIMIT ?
        `, params);

        await this.logger.info('Loading tiles into priority queue', { 
            count: tiles.length,
            settings: this.settings,
            zoomCondition
        });

        for (const tile of tiles) {
            // Calculate priority based on:
            // 1. Zoom level (higher = more important)
            // 2. Age (older = more important)
            // 3. Whether it's never been fetched (highest priority)
            const age = tile.last_modified ? 
                (new Date() - new Date(tile.last_modified).getTime()) / (1000 * 60 * 60) : // hours
                Infinity;
            
            const priority = (tile.z * 1000) + // Zoom level weight
                           (age * 100) +       // Age weight
                           (tile.last_modified ? 0 : 10000); // Never fetched bonus

            this.priorityQueue.enqueue(tile, priority);
        }

        await this.logger.info('Priority queue loaded', { 
            queueSize: this.priorityQueue.size(),
            maxZoom: this.settings.maxZoom,
            minZoom: this.settings.minZoom,
            zoomLevels: this.settings.zoomLevels,
            settings: this.settings
        });
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
                    await this.db.exec('BEGIN TRANSACTION');
                    try {
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
                            await this.insertHistoryStmt.run([
                                tile.x,
                                tile.y,
                                tile.z,
                                pbfData,
                                newHash
                            ]);
                        }

                        // Update current version
                        await this.insertPbfStmt.run([
                            tile.x,
                            tile.y,
                            tile.z,
                            pbfData,
                            newHash
                        ]);

                        await this.db.exec('COMMIT');
                        updated++;
                    } catch (error) {
                        await this.db.exec('ROLLBACK');
                        await this.logger.error('Failed to update tile', {
                            error: error.message,
                            x: tile.x,
                            y: tile.y,
                            z: tile.z
                        });
                        throw error;
                    }
                }

                processed++;
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