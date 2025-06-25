import { Logger } from './logger/logger.js';
import { PriorityQueue } from './priorityQueue.js';
import fetch from 'node-fetch';
import crypto from 'crypto';

// Sleep helper function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class TMSScraper {
    constructor(db) {
        this.db = db;
        this.minZoom = 10;
        this.maxZoom = parseInt(process.env.ZOOM_LEVEL || '16');
        this.priorityQueue = new PriorityQueue();
        this.settings = {
            batchSize: 1000,
            minQueueSize: 100,
            maxTilesToProcess: 1000,
            updateInterval: 24,
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
        // Initialize database
        await this.db.init();

        // Initialize logger after database is ready
        this.logger = new Logger('scraper');

        await this.logger.info('Starting scraper', {
            minZoom: this.minZoom,
            maxZoom: this.maxZoom
        });

        // Load settings from database
        const dbSettings = await this.db.getSettings();
        this.settings = { ...this.settings, ...dbSettings };
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
        // Always use maxZoom if no specific zoom level is set
        const zoomLevel = this.settings.zoomLevels?.[0] || this.settings.maxZoom;

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
                            updated++; // Increment updated count only when hash is different
                        }

                        // Update current version
                        await client.query(
                            'INSERT INTO pbf_tiles (x, y, z, data, hash, last_modified) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) ON CONFLICT (x, y, z) DO UPDATE SET data = EXCLUDED.data, hash = EXCLUDED.hash, last_modified = CURRENT_TIMESTAMP',
                            [tile.x, tile.y, tile.z, pbfData, newHash]
                        );

                        await client.query('COMMIT');
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

                if (processed % this.settings.minQueueSize === 0) {
                    await this.logger.info('Scraping progress', {
                        processed,
                        updated,
                        errors,
                        queueSize: this.priorityQueue.size(),
                        zoom: tile.z,
                        percentComplete: ((processed / (processed + this.priorityQueue.size())) * 100).toFixed(2),
                        settings: this.settings
                    });
                    
                    // Save stats after processing each tile
                    await this.db.saveStats({
                        processedTiles: this.settings.minQueueSize,
                    }, true); // Append stats

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

        // Fetch the actual counts from the database for final update
        const tileCounts = await this.db.get(`
            SELECT 
                (SELECT COUNT(*) FROM pbf_tiles) as current_tiles,
                (SELECT COUNT(*) FROM pbf_tiles_history) as total_versions
        `);

        // Final stats update after scraping is complete
        await this.db.saveStats({
            processedTiles: tileCounts.current_tiles,
            updatedTiles: tileCounts.total_versions,
            currentZoom: currentZoom
        }, false); // Update final stats

        const endTime = new Date();
        const duration = (endTime - startTime) / 1000; // Convert to seconds
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = Math.floor(duration % 60);

        await this.logger.info('PBF scraping completed', {
            totalProcessed: processed,
            totalUpdated: updated,
            totalErrors: errors,
            currentTiles: tileCounts.current_tiles,
            totalVersions: tileCounts.total_versions,
            successRate: ((processed - errors) / processed * 100).toFixed(2),
            duration: {
                total: duration.toFixed(2) + ' seconds',
                formatted: `${hours}h ${minutes}m ${seconds}s`,
            },
            settings: this.settings
        });
    }
}