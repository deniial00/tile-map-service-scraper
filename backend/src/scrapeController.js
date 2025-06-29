import { TMSScraper } from './tileScraper.js';
import { TileGenerator } from './tileGenerator.js';
import { Database } from './database.js';
import { TileServer } from './tileServer.js';
export class ScraperController {
    constructor() {
        this.db = new Database({
            type: 'postgres',
            user: process.env.POSTGRES_USER || 'postgres',
            host: process.env.POSTGRES_HOST || 'localhost',
            database: process.env.POSTGRES_DB || 'tmss',
            password: process.env.POSTGRES_PASSWORD || 'postgres',
            port: parseInt(process.env.POSTGRES_PORT || '5432')
        });

        this.scraper = new TMSScraper(this.db);
        this.tileGenerator = new TileGenerator(this.db);
        this.tileServer = new TileServer(this.db);
        this.isInitialized = false;
        this.isRunning = false;
        this.currentOperation = null;
        this.tileGenerationPromise = null;
        this.settings = {
            batchSize: 1000,        // Number of tiles to load into queue at once
            minQueueSize: 100,      // Minimum queue size before loading more tiles
            maxTilesToProcess: 0,   // 0 means process all tiles
            updateInterval: 24,     // Hours between updates for each tile
            minZoom: 10,            // Minimum zoom level to scrape
            maxZoom: process.env.ZOOM_LEVEL || 15,            // Maximum zoom level to scrape
            zoomLevels: []          // Specific zoom levels to scrape (empty means all)
        };

        // Initialize database and settings immediately
        this.init().catch(error => {
            console.error('Failed to initialize controller:', error);
            this.close();
            throw error;
        });
    }

    async close() {
        if (this.db) {
            await this.db.close();
        }
    }

    async getStatus() {
        const stats = await this.scraper.db.getStats();

        const status = {
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            currentOperation: this.currentOperation,
            stats: {
                ...stats
            }
        };

        if (this.currentOperation === 'generating_tiles' && status.stats.initialization_start_time) {
            status.initializationProgress = {
                startTime: status.stats.initialization_start_time,
                duration: (new Date() - new Date(status.stats.initialization_start_time)) / 1000,
                processedTiles: status.stats.processed_tiles,
                totalTiles: status.stats.total_tiles,
                currentZoom: status.stats.current_zoom
            };
        }

        return status;
    }

    async updateStats(stats, append = false) {
        const updatedStats = {
            ...stats,
            lastUpdate: new Date()
        };
        await this.scraper.db.saveStats(updatedStats, append);
    }

    async generateTilesInBackground() {
        try {
            this.currentOperation = 'generating_tiles';
            await this.scraper.db.resetTiles();
            await this.updateStats({ initializationStartTime: new Date() });
            
            await this.tileGenerator.init();
            const tileCount = await this.tileGenerator.generateTiles();

            await this.updateStats({ 
                initializationEndTime: new Date(), 
                totalTiles: tileCount 
            });

            this.currentOperation = null;
            this.isInitialized = true;
            
        } catch (error) {
            this.currentOperation = null;
            this.isInitialized = false;
            console.error('Error generating tiles:', error);
            throw error;
        }
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        return this.settings;
    }

    getSettings() {
        return this.settings;
    }

    async startScraping() {
        if (this.isRunning) {
            throw new Error('Scraping is already running');
        }

        try {
            this.isRunning = true;
            this.currentOperation = 'scraping';

            if (!this.isInitialized) {
                await this.scraper.init();
                this.isInitialized = true;
            }

            this.scraper.settings = { ...this.settings };

            this.tileGenerationPromise = this.scraper.scrapePbfTiles()
                .then(async () => {
                    this.isRunning = false;
                    this.currentOperation = null;
                })
                .catch(async error => {
                    this.isRunning = false;
                    this.currentOperation = null;
                    throw error;
                });

            return { status: 'started', message: 'Scraping started successfully' };
        } catch (error) {
            this.isRunning = false;
            this.currentOperation = null;
            throw error;
        }
    }

    async loadSettings() {
        try {
            const loadedSettings = await this.scraper.db.getSettings();
            
            // Merge with defaults, keeping defaults for missing settings
            this.settings = { ...this.settings, ...loadedSettings };
            return this.settings;
        } catch (error) {
            console.error('Error loading settings:', error);
            return this.settings;
        }
    }

    async saveSettings(settings) {
        try {
            await this.scraper.db.saveSettings(settings);
            this.settings = { ...this.settings, ...settings };
            return this.settings;
        } catch (error) {
            throw error;
        }
    }

    async init() {
        if (!this.isInitialized) {
            try {
                // Initialize database and load settings
                await this.scraper.init();
                await this.tileGenerator.init();
                await this.loadSettings();
                this.isInitialized = true;
            } catch (error) {
                this.isInitialized = false;
                throw error;
            }
        }
    }
}