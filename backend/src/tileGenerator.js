import fs from 'fs';
import { bbox } from '@turf/turf';
import booleanIntersects from '@turf/boolean-intersects';
import { Logger } from './logger/logger.js';

export class TileGenerator {
    constructor(db) {
        this.db = db;
        this.minZoom = 10;
        this.maxZoom = parseInt(process.env.ZOOM_LEVEL || '16');
        this.geojsonPath = 'data/austria.geojson';
        this.austriaData = null;
        this.logger = new Logger('generator');
        
        if (isNaN(this.maxZoom)) {
            throw new Error('Invalid ZOOM_LEVEL environment variable');
        }
    }

    async init() {
        // Load Austria GeoJSON
        await this.logger.info('Loading Austria GeoJSON...');
        this.austriaData = JSON.parse(fs.readFileSync(this.geojsonPath, 'utf8'));
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
        let totalTileCount = 0;
                
        await this.logger.info(`Starting with zoom level ${this.minZoom}`);
        totalTileCount += await this.generateTilesForZoom(this.minZoom, bounds);
        
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

                                if (tileBatch.length >= 1000) {
                                    await this.batchInsertTiles(tileBatch);
                                    totalTileCount += tileBatch.length;
                                    await this.updateTotalTiles(totalTileCount);
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
                    totalTileCount += tileBatch.length;
                    await this.updateTotalTiles(totalTileCount);
                }
                
            } catch (error) {
                await this.logger.error(`Error processing zoom level ${zoom}:`, { error: error.message });
                throw error;
            }
            
            const tileCountForZoom = await this.db.get(
                'SELECT COUNT(*) as count FROM tiles WHERE z = $1',
                [zoom]
            );
            await this.logger.info(`Found ${tileCountForZoom.count} tiles at zoom level ${zoom}`);
        }
        return totalTileCount;
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
                await this.updateTotalTiles(tilesFound, true);
            }
            await client.query('COMMIT');
        } catch (error) {
            await this.logger.error('Error during initial tile generation:', { error: error.message });
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
            const actualTileCount = await this.db.run(`SELECT COUNT(*) as count FROM tiles WHERE z = $1`, [zoom]);
            await this.updateTotalTiles(actualTileCount.count, false);
        }
        
        await this.logger.info(`Total tiles found: ${tilesFound}`);
        return tilesFound;
    }

    async updateTotalTiles(totalTiles, append = false) {
        const updatedStats = {
            totalTiles: totalTiles,
            lastUpdate: new Date()
        };
        await this.db.saveStats(updatedStats, append);
    }
} 