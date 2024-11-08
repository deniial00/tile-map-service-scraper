# scripts/init_db.py
import sqlite3
import os

def init_db():
    # Ensure data directory exists
    os.makedirs('/app/data', exist_ok=True)
    
    # Connect to database
    conn = sqlite3.connect('/app/data/tiles.db')
    cursor = conn.cursor()
    
    # Create tiles table
    cursor.execute('''
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
    
    # Create indexes
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_xyz ON tiles(x, y, z)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_updated ON tiles(updated_at)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_requested ON tiles(last_requested)')
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
