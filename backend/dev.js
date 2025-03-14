import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

async function extractPbfData() {
    console.log('Starting PBF data extraction...');
    const dbPath = '/data/tiles.db';
    
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        console.log(`Creating data directory: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`Opening database at ${dbPath}...`);
    // Open database with WAL mode
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    console.log('Enabling database optimizations...');
    // Enable WAL mode and optimizations
    await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -64000;
    `);

    try {
        console.log('Querying PBF tiles from database...');
        // Get a sample PBF tile
        const tile = await db.get(`
            SELECT x, y, z, data, hash 
            FROM pbf_tiles
            WHERE z = 15
            LIMIT 1
        `);

        if (!tile) {
            console.log('No PBF tiles found in database');
            return;
        }

        console.log(`\nProcessing tile at coordinates: x=${tile.x}, y=${tile.y}, z=${tile.z}`);
        console.log(`Tile hash: ${tile.hash}`);
        console.log(`Tile data size: ${tile.data.length} bytes`);

        console.log('\nDecoding PBF data...');
        // Decode the PBF data using Mapbox's vector-tile library
        const pbf = new Pbf(tile.data);
        const vectorTile = new VectorTile(pbf);

        // Process each layer
        for (const layerName in vectorTile.layers) {
            const layer = vectorTile.layers[layerName];
            console.log(`\nLayer: ${layerName}`);
            console.log(`Version: ${layer.version}`);
            console.log(`Extent: ${layer.extent}`);
            console.log(`Features: ${layer.length}`);

            // Process each feature
            for (let i = 0; i < layer.length; i++) {
                const feature = layer.feature(i);
                console.log(`\nFeature ID: ${feature.id}`);
                console.log(`Type: ${feature.type}`); // 1=Point, 2=LineString, 3=Polygon
                
                // Get feature properties
                const properties = feature.properties;
                console.log('Properties:', properties);

                // Get geometry as GeoJSON
                const geometry = feature.loadGeometry();
                console.log('Geometry:', JSON.stringify(geometry));

                // Convert tile coordinates to normalized coordinates (0-1 range)
                const extent = layer.extent;
                const normalizedCoords = geometry.map(ring => 
                    ring.map(point => [point.x / extent, point.y / extent])
                );
                console.log('Normalized coordinates:', JSON.stringify(normalizedCoords));
            }
        }

    } catch (error) {
        console.error('\nError processing PBF data:', error);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    } finally {
        console.log('\nClosing database connection...');
        await db.close();
        console.log('Database connection closed');
    }
}

// Run the extraction
console.log('Starting PBF data extraction script...');
extractPbfData().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 