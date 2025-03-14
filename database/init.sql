-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Create tiles table with PostGIS geometry
CREATE TABLE IF NOT EXISTS tiles (
    x INTEGER,
    y INTEGER,
    z INTEGER,
    parent_x INTEGER,
    parent_y INTEGER,
    parent_z INTEGER,
    geom geometry(Polygon, 4326),
    PRIMARY KEY (x, y, z)
);

-- Create PBF tiles table
CREATE TABLE IF NOT EXISTS pbf_tiles (
    x INTEGER,
    y INTEGER,
    z INTEGER,
    data BYTEA,
    hash TEXT,
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (x, y, z)
);

-- Create PBF history table
CREATE TABLE IF NOT EXISTS pbf_tiles_history (
    id SERIAL PRIMARY KEY,
    x INTEGER,
    y INTEGER,
    z INTEGER,
    data BYTEA,
    hash TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indices
CREATE INDEX IF NOT EXISTS idx_pbf_modified 
ON pbf_tiles(last_modified);

CREATE INDEX IF NOT EXISTS idx_history_coords 
ON pbf_tiles_history(x, y, z);

CREATE INDEX IF NOT EXISTS idx_history_date 
ON pbf_tiles_history(created_at);

CREATE INDEX IF NOT EXISTS idx_tiles_geom 
ON tiles USING GIST (geom);

-- Verify PostGIS installation
SELECT PostGIS_Version(); 