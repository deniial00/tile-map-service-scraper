import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import * as turf from '@turf/turf';

// Helper function to get adjacent tiles
function getAdjacentTiles(x, y, z) {
    return [
        { x, y, z },           // current tile
        { x: x + 1, y, z },    // right
        { x: x - 1, y, z },    // left
        { x, y: y + 1, z },    // bottom
        { x, y: y - 1, z },    // top
        { x: x + 1, y: y + 1, z }, // bottom-right
        { x: x - 1, y: y + 1, z }, // bottom-left
        { x: x + 1, y: y - 1, z }, // top-right
        { x: x - 1, y: y - 1, z }  // top-left
    ];
}

// Helper function to convert tile coordinates to lat/lon
function tileToLatLon(x, y, z) {
    const n = Math.pow(2, z);
    const lon = x / n * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return { lat, lon };
}

// Helper function to convert tile coordinates to GeoJSON polygon
function tileToGeoJSON(geometry, tileX, tileY, tileZ, extent) {
    const coordinates = geometry.map(ring => 
        ring.map(point => {
            const normalizedX = point.x / extent;
            const normalizedY = point.y / extent;
            const x = tileX + normalizedX;
            const y = tileY + normalizedY;
            const { lat, lon } = tileToLatLon(x, y, tileZ);
            return [lon, lat];
        })
    );

    return {
        type: 'Polygon',
        coordinates: coordinates
    };
}

async function mergeParcels() {
    console.log('Starting parcel merging process...');
    const dbPath = '/data/tiles.db';
    
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        console.log(`Creating data directory: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`Opening database at ${dbPath}...`);
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    console.log('Enabling database optimizations...');
    await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -64000;
    `);

    try {
        // Get a sample tile to start with
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
        
        // Get all adjacent tiles
        const adjacentTiles = getAdjacentTiles(tile.x, tile.y, tile.z);
        const tiles = await Promise.all(
            adjacentTiles.map(async ({ x, y, z }) => {
                const t = await db.get(`
                    SELECT x, y, z, data, hash 
                    FROM pbf_tiles
                    WHERE x = ? AND y = ? AND z = ?
                `, [x, y, z]);
                return t;
            })
        );

        // Store all parcel fragments by ID
        const parcelFragments = new Map();

        // Process each tile
        for (const t of tiles) {
            if (!t) continue;

            console.log(`\nProcessing tile at coordinates: x=${t.x}, y=${t.y}, z=${t.z}`);

            // Decode the PBF data
            const pbf = new Pbf(t.data);
            const vectorTile = new VectorTile(pbf);

            // Process the 'gst' layer (parcels)
            const layer = vectorTile.layers['gst'];
            if (!layer) {
                console.log('No parcel layer found in this tile');
                continue;
            }

            console.log(`Found ${layer.length} parcels in this tile`);

            // Process each parcel
            for (let i = 0; i < layer.length; i++) {
                const feature = layer.feature(i);
                const featureId = feature.properties['id'] || feature.id;
                
                // Get geometry and convert to GeoJSON
                const geometry = feature.loadGeometry();
                const extent = layer.extent;
                const geojson = tileToGeoJSON(geometry, t.x, t.y, t.z, extent);

                // Add to parcel fragments
                if (!parcelFragments.has(featureId)) {
                    parcelFragments.set(featureId, {
                        id: featureId,
                        properties: feature.properties,
                        fragments: []
                    });
                }
                parcelFragments.get(featureId).fragments.push(geojson);
            }
        }

        // Merge fragments for each parcel
        console.log('\nMerging parcel fragments...');
        const mergedParcels = [];

        for (const [id, parcel] of parcelFragments) {
            if (parcel.fragments.length === 1) {
                // Single fragment, no need to merge
                mergedParcels.push({
                    type: 'Feature',
                    id: parcel.id,
                    properties: parcel.properties,
                    geometry: parcel.fragments[0]
                });
            } else {
                // Multiple fragments, merge them
                console.log(`Merging ${parcel.fragments.length} fragments for parcel ${id}`);
                
                // Create a union of all fragments
                let merged = parcel.fragments[0];
                for (let i = 1; i < parcel.fragments.length; i++) {
                    try {
                        merged = turf.union(
                            turf.feature(merged),
                            turf.feature(parcel.fragments[i])
                        );
                    } catch (error) {
                        console.error(`Error merging fragment ${i} for parcel ${id}:`, error);
                    }
                }

                mergedParcels.push({
                    type: 'Feature',
                    id: parcel.id,
                    properties: parcel.properties,
                    geometry: merged.geometry
                });
            }
        }

        // Save merged parcels to GeoJSON file
        const outputPath = '/data/merged_parcels.geojson';
        const geojsonCollection = {
            type: 'FeatureCollection',
            features: mergedParcels
        };

        fs.writeFileSync(outputPath, JSON.stringify(geojsonCollection, null, 2));
        console.log(`\nSaved ${mergedParcels.length} merged parcels to ${outputPath}`);

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

// Run the merging process
console.log('Starting parcel merging script...');
mergeParcels().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 