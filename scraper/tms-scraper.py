import sqlite3
import requests
import time
from datetime import datetime
import geopandas as gpd
import mercantile
from shapely.geometry import box, Point
from queue import PriorityQueue
import os
import logging

class TMSScraperAustria:
    def __init__(self, db_path='tiles.db', shapefile_path='austria.shp'):
        self.tms_url_template = 'https://kataster.bev.gv.at/tiles/kataster/{z}/{x}/{y}.pbf'
        self.zoom_level = 16
        self.sleep_between_requests = 0.1  # 100ms
        self.shapefile_path = shapefile_path
        self.db_path = db_path
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('scraper.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # Initialize database and load Austria boundary
        self._init_database()
        self._load_austria_boundary()
        
    def _init_database(self):
        """Initialize SQLite database with necessary tables"""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        
        c.execute('''
            CREATE TABLE IF NOT EXISTS tiles (
                id INTEGER PRIMARY KEY,
                x INTEGER,
                y INTEGER,
                z INTEGER,
                last_requested TIMESTAMP,
                updated_at TIMESTAMP,
                data BLOB,
                UNIQUE(x, y, z)
            )
        ''')
        
        conn.commit()
        conn.close()
        
    def _load_austria_boundary(self):
        """Load Austria boundary from shapefile"""
        self.austria_gdf = gpd.read_file(self.shapefile_path)
        self.austria_boundary = self.austria_gdf.geometry.unary_union
        
    def _tile_intersects_austria(self, tile):
        """Check if a tile intersects with Austria's boundary"""
        bounds = mercantile.bounds(tile)
        tile_box = box(bounds.west, bounds.south, bounds.east, bounds.north)
        return tile_box.intersects(self.austria_boundary)
    
    def _get_tiles_within_austria(self):
        """Generate list of tiles that intersect with Austria"""
        tiles = []
        austria_bounds = self.austria_boundary.bounds
        
        # Convert bounds to tile coordinates
        min_tile = mercantile.tile(austria_bounds[0], austria_bounds[3], self.zoom_level)
        max_tile = mercantile.tile(austria_bounds[2], austria_bounds[1], self.zoom_level)
        
        for x in range(min_tile.x, max_tile.x + 1):
            for y in range(min_tile.y, max_tile.y + 1):
                tile = mercantile.Tile(x, y, self.zoom_level)
                if self._tile_intersects_austria(tile):
                    tiles.append(tile)
                    
        return tiles
    
    def _get_priority_queue(self):
        """Create priority queue of tiles based on last_requested timestamp"""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        
        pq = PriorityQueue()
        
        # Get all existing tiles
        c.execute('''
            SELECT x, y, z, last_requested 
            FROM tiles 
            ORDER BY last_requested ASC NULLS FIRST
        ''')
        
        for x, y, z, last_requested in c.fetchall():
            # Use timestamp as priority (None = highest priority)
            priority = time.mktime(datetime.strptime(last_requested, '%Y-%m-%d %H:%M:%S').timetuple()) if last_requested else 0
            pq.put((priority, (x, y, z)))
            
        conn.close()
        return pq
    
    def _download_tile(self, x, y, z):
        """Download a single tile"""
        url = self.tms_url_template.format(z=z, x=x, y=y)
        response = requests.get(url)
        
        if response.status_code == 200:
            return response.content
        else:
            self.logger.error(f"Failed to download tile {x}/{y}/{z}: {response.status_code}")
            return None
            
    def _update_tile_record(self, x, y, z, data):
        """Update or insert tile record in database"""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        c.execute('''
            INSERT OR REPLACE INTO tiles (x, y, z, last_requested, updated_at, data)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (x, y, z, now, now, data))
        
        conn.commit()
        conn.close()
        
    def scrape_tiles(self, num_tiles=5000):
        """Main scraping function"""
        tiles = self._get_tiles_within_austria()
        pq = self._get_priority_queue()
        
        self.logger.info(f"Starting scrape of {num_tiles} tiles")
        processed_count = 0
        
        while processed_count < num_tiles and not pq.empty():
            _, (x, y, z) = pq.get()
            
            # Download tile
            tile_data = self._download_tile(x, y, z)
            if tile_data:
                self._update_tile_record(x, y, z, tile_data)
                processed_count += 1
                self.logger.info(f"Successfully processed tile {x}/{y}/{z} ({processed_count}/{num_tiles})")
            
            time.sleep(self.sleep_between_requests)
            
        self.logger.info(f"Scraping completed. Processed {processed_count} tiles.")

if __name__ == "__main__":
    scraper = TMSScraperAustria(
        db_path='tiles.db',
        shapefile_path='austria.shp'
    )
    scraper.scrape_tiles(num_tiles=5000)
