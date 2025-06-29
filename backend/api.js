import express from 'express';
import { HttpLogger } from './src/logger/httpLogger.js';
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

// Create controller (database will be initialized in constructor)
const controller = new ScraperController();

// Serve PBF tiles
app.get('/api/tiles/:z/:x/:y.pbf', async (req, res) => {
    const { z, x, y } = req.params;

    // Validate tile coordinates
    if (!controller.tileServer.validateTileCoordinates(x, y, z)) {
        return res.status(400).json({ error: 'Invalid tile coordinates' });
    }

    try {

        // const tileData = await controller.tileServer.getTile(x, y, z);
        const tileData = await controller.tileServer.getTile(x, y, z);

        if (!tileData) {
            return res.status(404).send('Tile not found');
        }

        // Set appropriate headers
        res.set({
            'Content-Type': 'application/x-protobuf',
            'Access-Control-Allow-Origin': '*',  // Enable CORS
            'Cache-Control': 'public, max-age=86400'  // Cache for 24 hours
        });

        res.send(tileData);
    } catch (error) {
        console.error('Error serving tile:', error);
        res.status(500).json({ error: 'Error serving tile' });
    }
});

// Get current status
app.get('/api/status', async (req, res) => {
    const status = await controller.getStatus();
    res.json(status);
});

// Generate tiles
app.post('/api/init', async (req, res) => {
    // Check if already generating tiles
    if (controller.currentOperation === 'generating_tiles') {
        return res.status(400).json({ 
            error: 'Tile generation already in progress',
            status: await controller.getStatus()
        });
    }

    try {
        // Check if we need to generate tiles
        const tileCount = await controller.scraper.db.get('SELECT COUNT(*) as count FROM tiles');
        if (tileCount.count === 0 || req.query.force) {
            controller.currentOperation = 'generating_tiles';
            // Start tile generation in background
            controller.tileGenerationPromise = controller.generateTilesInBackground();
            
            res.json({ 
                success: true, 
                message: 'Tile generation started and running in background.',
                currentOperation: 'generating_tiles',
                force: req.query.force === 'true',
                status: await controller.getStatus()
            });
            return;
        }

        // Tiles already exist
        res.json({ 
            success: true, 
            message: 'Tiles already exist. Use ?force=true to regenerate tiles.',
            status: await controller.getStatus()
        });

    } catch (error) {
        controller.currentOperation = null;
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
