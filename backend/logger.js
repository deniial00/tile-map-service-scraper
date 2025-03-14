import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export class Logger {
    constructor(component, db) {
        this.component = component;
        this.db = db;
    }

    async init() {
        // Create logs table if it doesn't exist
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                component TEXT,
                level TEXT,
                message TEXT,
                metadata TEXT
            )
        `);

        // Prepare statement for faster inserts
        this.logStmt = await this.db.prepare(`
            INSERT INTO logs (component, level, message, metadata)
            VALUES (?, ?, ?, ?)
        `);
    }

    async log(level, message, metadata = {}) {
        try {
            await this.logStmt.run([
                this.component,
                level,
                message,
                JSON.stringify(metadata)
            ]);
        } catch (error) {
            // Fallback to console if DB logging fails
            console.error('Logging to DB failed:', error);
            console.log(`[${this.component}] ${level}: ${message}`, metadata);
        }
    }

    async info(message, metadata = {}) {
        await this.log('info', message, metadata);
    }

    async error(message, metadata = {}) {
        await this.log('error', message, metadata);
    }

    async warn(message, metadata = {}) {
        await this.log('warn', message, metadata);
    }

    async debug(message, metadata = {}) {
        await this.log('debug', message, metadata);
    }
}