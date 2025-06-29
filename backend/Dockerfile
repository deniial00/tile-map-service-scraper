FROM node:20-slim

WORKDIR /app

# Install build dependencies for sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies with verbose output and verify installation
RUN npm install --verbose && \
    ls -la node_modules && \
    ls -la node_modules/express

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the API port
EXPOSE 3000

# Run the API server instead of the scraper directly
CMD ["node", "api.js"] 