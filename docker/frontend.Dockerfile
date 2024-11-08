FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy application code
COPY frontend/index.html ./
COPY frontend/vite.config.js ./
COPY frontend/src ./src
# COPY frontend/public ./public

# Build the application
RUN npm run build

# Install serve to run the built application
RUN npm install -g serve

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]