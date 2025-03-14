import pkg from 'pg';
const { Pool } = pkg;

export class Database {
    constructor(config) {
        this.config = config;
        this.pool = null;
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;

        // Create pool with longer connection timeout
        this.pool = new Pool({
            user: this.config.user,
            host: this.config.host,
            database: this.config.database,
            password: this.config.password,
            port: this.config.port || 5432,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });

        // Retry connection with exponential backoff
        let retries = 5;
        let delay = 2000; // Start with 2 seconds

        while (retries > 0) {
            try {
                const client = await this.pool.connect();
                await client.query('SELECT NOW()');
                client.release();
                this.isInitialized = true;
                return;
            } catch (error) {
                retries--;
                if (retries === 0) {
                    throw new Error(`Failed to connect to database after multiple attempts: ${error.message}`);
                }
                console.log(`Database connection attempt failed, retrying in ${delay/1000} seconds... (${retries} attempts remaining)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            }
        }
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.isInitialized = false;
        }
    }

    // Get a client from the pool
    async connect() {
        return this.pool.connect();
    }

    // Query operations
    async query(sql, params = []) {
        const client = await this.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows;
        } finally {
            client.release();
        }
    }

    async get(sql, params = []) {
        const client = await this.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows[0];
        } finally {
            client.release();
        }
    }

    async run(sql, params = []) {
        const client = await this.connect();
        try {
            return await client.query(sql, params);
        } finally {
            client.release();
        }
    }

    async exec(sql) {
        const client = await this.connect();
        try {
            return await client.query(sql);
        } finally {
            client.release();
        }
    }

    // Tile operations
    async getTile(x, y, z) {
        return this.get(`
            SELECT x, y, z, data, hash 
            FROM pbf_tiles
            WHERE x = $1 AND y = $2 AND z = $3
        `, [x, y, z]);
    }

    async getTilesByZoom(z) {
        return this.query(`
            SELECT x, y, z 
            FROM tiles 
            WHERE z = $1
        `, [z]);
    }

    async getTileCount() {
        return this.get('SELECT COUNT(*) as count FROM tiles');
    }

    async insertTile(x, y, z, parentX, parentY, parentZ, geom) {
        return this.run(`
            INSERT INTO tiles (x, y, z, parent_x, parent_y, parent_z, geom)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (x, y, z) DO NOTHING
        `, [x, y, z, parentX, parentY, parentZ, geom]);
    }

    async batchInsertTiles(tiles) {
        if (tiles.length === 0) return;

        const client = await this.connect();
        try {
            await client.query('BEGIN');
            for (const tile of tiles) {
                await client.query(`
                    INSERT INTO tiles (x, y, z, parent_x, parent_y, parent_z)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (x, y, z) DO NOTHING
                `, tile);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // PBF tile operations
    async insertPbfTile(x, y, z, data, hash) {
        return this.run(`
            INSERT INTO pbf_tiles (x, y, z, data, hash, last_modified)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (x, y, z) DO UPDATE SET
                data = EXCLUDED.data,
                hash = EXCLUDED.hash,
                last_modified = CURRENT_TIMESTAMP
        `, [x, y, z, data, hash]);
    }

    async insertPbfHistory(x, y, z, data, hash) {
        return this.run(`
            INSERT INTO pbf_tiles_history (x, y, z, data, hash)
            VALUES ($1, $2, $3, $4, $5)
        `, [x, y, z, data, hash]);
    }

    async getPbfTile(x, y, z) {
        return this.get(`
            SELECT x, y, z, data, hash 
            FROM pbf_tiles
            WHERE x = $1 AND y = $2 AND z = $3
        `, [x, y, z]);
    }

    // Settings operations
    async getSettings() {
        const settings = await this.query('SELECT key, value FROM settings');
        const result = {};
        
        for (const setting of settings) {
            try {
                result[setting.key] = JSON.parse(setting.value);
            } catch (e) {
                console.error(`Error parsing setting ${setting.key}:`, e);
            }
        }
        
        return result;
    }

    async saveSettings(settings) {
        const client = await this.connect();
        try {
            await client.query('BEGIN');
            for (const [key, value] of Object.entries(settings)) {
                await client.query(
                    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP',
                    [key, JSON.stringify(value)]
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

    // Statistics
    async getStats() {
        return this.get(`
            SELECT 
                (SELECT COUNT(*) FROM pbf_tiles) as current_tiles,
                (SELECT COUNT(*) FROM pbf_tiles_history) as total_versions
        `);
    }
} 