import express from 'express';
import { HttpLogger } from './src/httpLogger.js';
import { ScraperController } from './src/scrapeController.js';

const app = express();
app.use(express.json());

// Initialize HTTP logger
const httpLogger = new HttpLogger();

// HTTP request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        httpLogger.logRequest(req, res, duration);
    });
    next();
});

const controller = new ScraperController();

// Get current status
app.get('/api/status', async (req, res) => {
    const status = await controller.getStatus();
    res.json(status);
});

// Initialize scraper
app.post('/api/init', async (req, res) => {
    // Check if already initializing
    if (controller.currentOperation === 'generating_tiles') {
        return res.status(400).json({ 
            error: 'Tile generation already in progress',
            status: await controller.getStatus()
        });
    }

    try {
        controller.currentOperation = 'initializing';
        await controller.scraper.init();
        
        // Only generate tiles if not database_only mode
        if (!req.query.database_only) {
            // Check if we need to generate tiles
            const tileCount = await controller.scraper.db.get('SELECT COUNT(*) as count FROM tiles');
            if (tileCount.count === 0 || req.query.force) {
                // Start tile generation in background
                controller.tileGenerationPromise = controller.generateTilesInBackground();
                
                res.json({ 
                    success: true, 
                    message: 'Initialization started. Tile generation is running in background.',
                    currentOperation: 'generating_tiles',
                    force: req.query.force === 'true',
                    status: await controller.getStatus()
                });
                return;
            } else {
                res.status(400).json({ 
                    error: 'Tiles already exist. Use ?force=true to regenerate.',
                    status: await controller.getStatus()
                });
                return;
            }
        }

        // For database_only mode, just return success
        controller.isInitialized = true;
        controller.currentOperation = null;
        res.json({ 
            success: true, 
            message: 'Database initialized successfully',
            status: await controller.getStatus()
        });

    } catch (error) {
        controller.currentOperation = null;
        controller.isInitialized = false;
        res.status(500).json({ 
            error: error.message,
            status: await controller.getStatus()
        });
    }
});

// Start scraping
app.post('/api/scrape/start', async (req, res) => {
    if (!controller.isInitialized) {
        return res.status(400).json({ error: 'Scraper must be initialized first' });
    }
    if (controller.isRunning) {
        return res.status(400).json({ error: 'Scraper is already running' });
    }

    try {
        const result = await controller.startScraping();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stop scraping
app.post('/api/scrape/stop', (req, res) => {
    if (!controller.isRunning) {
        return res.status(400).json({ error: 'Scraper is not running' });
    }

    controller.isRunning = false;
    res.json({ success: true, message: 'Scraper will stop after current tile' });
});

// Get current settings
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await controller.loadSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update settings
app.post('/api/settings', async (req, res) => {
    try {
        const updatedSettings = await controller.saveSettings(req.body);
        res.json(updatedSettings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});
