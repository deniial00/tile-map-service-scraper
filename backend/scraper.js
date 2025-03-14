import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { bbox } from '@turf/turf';
import booleanIntersects from '@turf/boolean-intersects';
import path from 'path';
import { Logger } from './logger.js';

class TMSScraper {
    constructor() {
        this.minZoom = 10;
        this.maxZoom = parseInt(process.env.ZOOM_LEVEL || '16');
        this.dbPath = '/data/tiles.db';
        this.geojsonPath = '/data/austria.geojson';
        this.austriaData = null;
        
        if (isNaN(this.maxZoom)) {
            throw new Error('Invalid ZOOM_LEVEL environment variable');
        }
        
        console.log(`Using zoom levels: ${this.minZoom} to ${this.maxZoom}`);
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

        // Initialize logger after database is ready
        this.logger = new Logger('init', this.db);
        await this.logger.init();

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

    async run() {
        try {
            await this.init();
            await this.generateTiles();
            
            const result = await this.db.get('SELECT COUNT(*) as count FROM tiles');
            await this.logger.info(`Final tile count in database: ${result.count}`);
            await this.logger.info('Tile generation completed successfully');
        } catch (error) {
            await this.logger.error('Error during execution:', { error: error.message });
        } finally {
            await this.close();
        }
    }
}

// Run the scraper
const scraper = new TMSScraper();
scraper.run();
