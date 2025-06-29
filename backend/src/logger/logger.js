import fs from 'fs';
import path from 'path';

export class Logger {
    constructor(component) {
        this.component = component;
        this.logFile = '/logs/scraper.log';
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.logFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    formatMessage(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const metadataStr = Object.keys(metadata).length > 0 ? 
            ` ${JSON.stringify(metadata)}` : '';
        return `[${timestamp}] [${this.component}] ${level}: ${message}${metadataStr}`;
    }

    async log(level, message, metadata = {}) {
        const formattedMessage = this.formatMessage(level, message, metadata);
        
        // Write to console
        if (level === 'error') {
            console.error(formattedMessage);
        } else {
            console.log(formattedMessage);
        }

        // Append to file
        try {
            await fs.promises.appendFile(this.logFile, formattedMessage + '\n');
        } catch (error) {
            console.error(`Failed to write to log file: ${error.message}`);
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