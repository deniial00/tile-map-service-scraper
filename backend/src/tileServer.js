import { Logger } from './logger/logger.js';

export class TileServer {
    constructor(db) {
        this.db = db;
        this.logger = new Logger('tile_server');
    }

    async getTile(x, y, z) {
        try {
            const result = await this.db.get(
                'SELECT data FROM pbf_tiles WHERE x=$1 AND y=$2 AND z=$3 LIMIT 1;',
                [x, y, z]
            );

            if (!result) {
                await this.logger.info('Tile not found', { x, y, z });
                return null;
            }

            await this.logger.info('Tile served', { 
                x, y, z,
                size: result.data.length 
            });

            return result.data;
        } catch (error) {
            await this.logger.error('Error fetching tile', {
                error: error.message,
                x, y, z
            });
            throw error;
        }
    }

    // Helper method to validate tile coordinates
    validateTileCoordinates(x, y, z) {
        // Convert parameters to integers
        const xNum = parseInt(x);
        const yNum = parseInt(y);
        const zNum = parseInt(z);

        // Check if any conversion resulted in NaN
        if (isNaN(xNum) || isNaN(yNum) || isNaN(zNum)) {
            return false;
        }

        // Check zoom level bounds (typically 0-22, but we use our scraper's bounds)
        if (zNum < 10 || zNum > 16) {
            return false;
        }

        // Check x/y bounds for zoom level
        const maxTile = Math.pow(2, zNum) - 1;
        if (xNum < 0 || xNum > maxTile || yNum < 0 || yNum > maxTile) {
            return false;
        }

        return true;
    }
} 