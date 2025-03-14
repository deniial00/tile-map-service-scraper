import { TMSScraper } from './scraper.js';

export class ScraperController {
    constructor() {
        this.scraper = new TMSScraper();
        this.isInitialized = false;
        this.isRunning = false;
        this.currentOperation = null;
        this.stats = {
            totalTiles: 0,
            processedTiles: 0,
            updatedTiles: 0,
            currentZoom: null,
            lastUpdate: new Date(),
            initializationStartTime: null,
            initializationEndTime: null
        };
        this.tileGenerationPromise = null;
        this.settings = {
            batchSize: 1000,        // Number of tiles to load into queue at once
            minQueueSize: 100,      // Minimum queue size before loading more tiles
            maxTilesToProcess: 0,   // 0 means process all tiles
            updateInterval: 24,     // Hours between updates for each tile
            maxConcurrent: 5,       // Maximum concurrent tile fetches
            minZoom: 10,            // Minimum zoom level to scrape
            maxZoom: 16,            // Maximum zoom level to scrape
            zoomLevels: []          // Specific zoom levels to scrape (empty means all)
        };

        // Initialize database and settings immediately
        this.init().catch(error => {
            console.error('Failed to initialize controller:', error);
            throw error;
        });
    }

    async getStatus() {
        const status = {
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            currentOperation: this.currentOperation,
            stats: this.stats
        };

        if (this.currentOperation === 'generating_tiles') {
            status.initializationProgress = {
                startTime: this.stats.initializationStartTime,
                duration: this.stats.initializationStartTime ? 
                    (new Date() - this.stats.initializationStartTime) / 1000 : 0,
                processedTiles: this.stats.processedTiles,
                totalTiles: this.stats.totalTiles,
                currentZoom: this.stats.currentZoom
            };
        }

        return status;
    }

    updateStats(stats) {
        this.stats = { ...this.stats, ...stats, lastUpdate: new Date() };
    }

    async generateTilesInBackground() {
        try {
            this.currentOperation = 'generating_tiles';
            this.updateStats({ initializationStartTime: new Date() });
            
            // Get total tiles to process
            const tileCount = await this.scraper.db.get('SELECT COUNT(*) as count FROM tiles');
            this.updateStats({ totalTiles: tileCount.count });

            await this.scraper.generateTiles();
            
            this.currentOperation = null;
            this.isInitialized = true;
            this.updateStats({ 
                initializationEndTime: new Date(),
                processedTiles: tileCount.count
            });
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
            this.stats.initializationStartTime = new Date();

            // Initialize scraper if not already done
            if (!this.isInitialized) {
                await this.scraper.init();
                this.isInitialized = true;
            }

            // Pass current settings to scraper
            this.scraper.settings = { ...this.settings };

            // Start scraping in the background
            this.tileGenerationPromise = this.scraper.scrapePbfTiles()
                .then(() => {
                    this.isRunning = false;
                    this.currentOperation = null;
                    this.stats.initializationEndTime = new Date();
                })
                .catch(error => {
                    this.isRunning = false;
                    this.currentOperation = null;
                    this.stats.initializationEndTime = new Date();
                    throw error;
                });

            return { status: 'started', message: 'Scraping started successfully' };
        } catch (error) {
            this.isRunning = false;
            this.currentOperation = null;
            this.stats.initializationEndTime = new Date();
            throw error;
        }
    }

    async loadSettings() {
        try {
            const settings = await this.scraper.db.all('SELECT key, value FROM settings');
            const loadedSettings = {};
            
            for (const setting of settings) {
                try {
                    loadedSettings[setting.key] = JSON.parse(setting.value);
                } catch (e) {
                    console.error(`Error parsing setting ${setting.key}:`, e);
                }
            }

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
            await this.scraper.db.exec('BEGIN TRANSACTION');
            
            for (const [key, value] of Object.entries(settings)) {
                await this.scraper.db.run(
                    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                    [key, JSON.stringify(value)]
                );
            }
            
            await this.scraper.db.exec('COMMIT');
            this.settings = { ...this.settings, ...settings };
            return this.settings;
        } catch (error) {
            await this.scraper.db.exec('ROLLBACK');
            throw error;
        }
    }

    async init() {
        if (!this.isInitialized) {
            try {
                // Initialize database and load settings
                await this.scraper.init();
                await this.loadSettings();
                this.isInitialized = true;
            } catch (error) {
                this.isInitialized = false;
                throw error;
            }
        }
    }
}