from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from datetime import datetime
import sqlite3
import mercantile
import geopandas as gpd
from typing import List, Dict
import json

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    return sqlite3.connect('tiles.db')

@app.get("/tiles/{z}/{x}/{y}.pbf")
async def serve_tile(z: int, x: int, y: int):
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT data
            FROM tiles
            WHERE z = ? AND x = ? AND y = ?
        """, (z, x, y))
        
        result = cursor.fetchone()
        if result:
            # Update last_requested timestamp
            cursor.execute("""
                UPDATE tiles
                SET last_requested = ?
                WHERE z = ? AND x = ? AND y = ?
            """, (datetime.now().isoformat(), z, x, y))
            conn.commit()
            
            return Response(content=result[0], media_type="application/x-protobuf")
        else:
            raise HTTPException(status_code=404, detail="Tile not found")
            
    finally:
        conn.close()

@app.get("/api/tile-status")
async def get_tile_status(min_zoom: int = 14, max_zoom: int = 16, since: str = None):
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Load Austria boundary
        austria_gdf = gpd.read_file('austria.geojson')
        austria_bounds = austria_gdf.total_bounds
        
        tile_status = {
            'scraped': [],
            'missing': [],
            'updated': []
        }
        
        for z in range(min_zoom, max_zoom + 1):
            # Get tile ranges for Austria bounds
            min_tile = mercantile.tile(austria_bounds[0], austria_bounds[3], z)
            max_tile = mercantile.tile(austria_bounds[2], austria_bounds[1], z)
            
            # Query existing tiles
            cursor.execute("""
                SELECT x, y, z, updated_at
                FROM tiles
                WHERE z = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?
            """, (z, min_tile.x, max_tile.x, min_tile.y, max_tile.y))
            
            existing_tiles = {(row[0], row[1], row[2]): row[3] for row in cursor.fetchall()}
            
            # Process tiles
            for x in range(min_tile.x, max_tile.x + 1):
                for y in range(min_tile.y, max_tile.y + 1):
                    tile_key = (x, y, z)
                    
                    if tile_key in existing_tiles:
                        updated_at = existing_tiles[tile_key]
                        tile_info = {'x': x, 'y': y, 'z': z, 'updated_at': updated_at}
                        
                        if since and updated_at >= since:
                            tile_status['updated'].append(tile_info)
                        else:
                            tile_status['scraped'].append(tile_info)
                    else:
                        tile_status['missing'].append({'x': x, 'y': y, 'z': z})
        
        return tile_status
        
    finally:
        conn.close()

# Mount static files for the frontend
app.mount("/", StaticFiles(directory="public", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
