# TMS Scraper

A tile map service scraper for Austria's cadastral data, built with Node.js and SQLite.

## Features

- Generates and manages Google Mercator tiles for Austria
- Supports multiple zoom levels (10-16 by default)
- Prioritizes tile updates based on age and zoom level
- Maintains tile history with versioning
- RESTful API for control and monitoring
- Configurable scraping settings with persistence
- Efficient batch processing with SQLite optimizations
- Database-only initialization option for quick setup
- Separate HTTP request logging for API monitoring
- Rate limiting with configurable request delays

## Prerequisites

- Node.js 16 or higher
- Docker and Docker Compose (for containerized deployment)
- SQLite3

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd tmss
```

2. Install dependencies:
```bash
npm install
```

3. Place the Austria GeoJSON file:
```bash
cp path/to/austria.geojson backend/data/
```

## Docker Deployment

1. Build and start the container:
```bash
docker-compose up --build
```

The API will be available at `http://localhost:3000`.

## API Endpoints

### Status
```bash
GET /api/status
```
Returns the current status of the scraper, including:
- Initialization state
- Running state
- Current operation
- Statistics (processed tiles, updated tiles, etc.)

### Initialize
```bash
POST /api/init
```
Initializes the scraper and generates tile coordinates. Options:
- `?force=true` - Force regeneration of tiles
- `?database_only=true` - Only initialize database without generating tiles (useful for testing settings)

### Start Scraping
```bash
POST /api/scrape/start
```
Starts the scraping process with current settings.

### Stop Scraping
```bash
POST /api/scrape/stop
```
Stops the scraping process gracefully.

### Get Settings
```bash
GET /api/settings
```
Returns current scraping settings.

### Update Settings
```bash
POST /api/settings
```
Updates scraping settings. Example:
```json
{
    "batchSize": 1000,
    "minQueueSize": 100,
    "maxTilesToProcess": 0,
    "updateInterval": 24,
    "maxConcurrent": 5,
    "minZoom": 10,
    "maxZoom": 16,
    "zoomLevels": [],
    "requestDelay": 500
}
```

## Settings

Settings are persisted in the SQLite database and will be restored when the scraper restarts. The following settings are available:

| Setting | Description | Default | Type |
|---------|-------------|---------|------|
| batchSize | Number of tiles to load into queue at once | 1000 | number |
| minQueueSize | Minimum queue size before loading more tiles | 100 | number |
| maxTilesToProcess | Maximum tiles to process (0 = unlimited) | 0 | number |
| updateInterval | Hours between updates for each tile | 24 | number |
| maxConcurrent | Maximum concurrent tile fetches | 5 | number |
| minZoom | Minimum zoom level to scrape | 10 | number |
| maxZoom | Maximum zoom level to scrape | 16 | number |
| zoomLevels | Specific zoom levels to scrape (empty = all) | [] | number[] |
| requestDelay | Delay in milliseconds between tile requests | 500 | number |

Settings can be updated at any time and will be immediately applied to the current scraping process. If the scraper is restarted, the last saved settings will be automatically loaded.

## Quick Start Guide

1. Initialize the database (without generating tiles):
```bash
curl -X POST "http://localhost:3000/api/init?database_only=true"
```

2. Configure settings for specific zoom levels:
```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "zoomLevels": [12, 13],
    "batchSize": 500,
    "updateInterval": 12,
    "requestDelay": 500
  }'
```

3. Verify settings:
```bash
curl http://localhost:3000/api/settings
```

4. Start scraping:
```bash
curl -X POST http://localhost:3000/api/scrape/start
```

5. Monitor progress:
```bash
curl http://localhost:3000/api/status
```

## Database Schema

### settings
- Stores scraper configuration
- Fields: key (TEXT), value (TEXT), updated_at (DATETIME)

### tiles
- Primary table for tile coordinates
- Fields: x, y, z, parent_x, parent_y, parent_z

### pbf_tiles
- Current version of PBF tiles
- Fields: x, y, z, data (BLOB), hash, last_modified

### pbf_tiles_history
- Historical versions of PBF tiles
- Fields: id, x, y, z, data (BLOB), hash, created_at

## Logging

The scraper maintains two separate log files:

### HTTP Request Log (`/data/http.log`)
Logs all API requests with the following information:
- Timestamp
- IP address
- HTTP method
- URL
- Status code
- Request duration
- User agent
- Query parameters
- Request body

Example log entry:
```
[2024-03-14T13:34:10.705Z] 127.0.0.1 POST /api/settings 200 45ms curl/7.64.1 query=- body={"batchSize":500}
```

### Scraper Log (`/data/scraper.log`)
Logs scraper operations including:
- Initialization progress
- Tile generation status
- Scraping progress
- Errors and warnings
- Performance metrics

## Error Handling

The scraper includes robust error handling:
- Transaction rollback on database errors
- Graceful handling of network issues
- Automatic retry of failed tiles
- Detailed error logging

## Performance Considerations

- Uses SQLite WAL mode for better write performance
- Implements batch processing for database operations
- Maintains a priority queue for efficient tile processing
- Caches Austria GeoJSON data
- Uses prepared statements for database operations
- Rate limiting with configurable delays between requests

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

[Your License Here]