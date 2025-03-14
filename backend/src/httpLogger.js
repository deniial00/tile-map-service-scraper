import { Logger } from './logger.js';
import fs from 'fs';

export class HttpLogger extends Logger {
    constructor() {
        super('http');
        this.logFile = '/data/http.log';
    }

    formatRequest(req, res, duration) {
        const timestamp = new Date().toISOString();
        const method = req.method;
        const url = req.url;
        const status = res.statusCode;
        const userAgent = req.get('user-agent') || '-';
        const ip = req.ip || '-';
        const query = Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '-';
        const body = Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : '-';
        
        return `[${timestamp}] ${ip} ${method} ${url} ${status} ${duration}ms ${userAgent} query=${query} body=${body}`;
    }

    async logRequest(req, res, duration) {
        const message = this.formatRequest(req, res, duration);
        
        // Write to console
        console.log(message);

        // Append to file
        try {
            await fs.promises.appendFile(this.logFile, message + '\n');
        } catch (error) {
            console.error(`Failed to write to HTTP log file: ${error.message}`);
        }
    }
} 