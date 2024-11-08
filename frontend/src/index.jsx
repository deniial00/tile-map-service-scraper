// index.jsx
import { render } from 'solid-js/web';
import { createSignal, createEffect, onMount } from 'solid-js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

const App = () => {
  let mapContainer;
  const [map, setMap] = createSignal(null);
  const [mode, setMode] = createSignal('scraped');
  const [since, setSince] = createSignal(new Date().toISOString().split('T')[0]);
  const [tileStatus, setTileStatus] = createSignal({});
  
  const fetchTileStatus = async () => {
    const response = await fetch(`/api/tile-status?since=${since()}`);
    const data = await response.json();
    setTileStatus(data);
    updateTileLayers();
  };
  
  const updateTileLayers = () => {
    const currentMap = map();
    if (!currentMap) return;
    
    // Remove existing layers
    ['scraped-tiles', 'missing-tiles', 'updated-tiles'].forEach(layerId => {
      if (currentMap.getLayer(layerId)) currentMap.removeLayer(layerId);
      if (currentMap.getSource(layerId)) currentMap.removeSource(layerId);
    });
    
    // Add vector tile source
    if (!currentMap.getSource('kataster')) {
      currentMap.addSource('kataster', {
        type: 'vector',
        tiles: [`http://localhost:8000/tiles/{z}/{x}/{y}.pbf`],
        minzoom: 14,
        maxzoom: 16
      });
    }
    
    // Add overlay layers based on tile status
    const status = tileStatus();
    if (!status) return;
    
    if (mode() === 'scraped' || mode() === 'all') {
      currentMap.addLayer({
        id: 'scraped-tiles',
        type: 'fill',
        source: 'kataster',
        'source-layer': 'default',  // adjust based on your vector tile layer name
        paint: {
          'fill-color': '#00ff00',
          'fill-opacity': 0.2
        }
      });
    }
    
    if (mode() === 'missing' || mode() === 'all') {
      currentMap.addSource('missing-tiles', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: status.missing.map(tile => ({
            type: 'Feature',
            geometry: mercatorTileToGeoJSON(tile.x, tile.y, tile.z),
            properties: { type: 'missing' }
          }))
        }
      });
      
      currentMap.addLayer({
        id: 'missing-tiles',
        type: 'fill',
        source: 'missing-tiles',
        paint: {
          'fill-color': '#ff0000',
          'fill-opacity': 0.2
        }
      });
    }
    
    if (mode() === 'updated' || mode() === 'all') {
      currentMap.addSource('updated-tiles', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: status.updated.map(tile => ({
            type: 'Feature',
            geometry: mercatorTileToGeoJSON(tile.x, tile.y, tile.z),
            properties: { 
              type: 'updated',
              updated_at: tile.updated_at
            }
          }))
        }
      });
      
      currentMap.addLayer({
        id: 'updated-tiles',
        type: 'fill',
        source: 'updated-tiles',
        paint: {
          'fill-color': '#0000ff',
          'fill-opacity': 0.2
        }
      });
    }
  };
  
  const mercatorTileToGeoJSON = (x, y, z) => {
    const n = Math.pow(2, z);
    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;
    const north = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * (180 / Math.PI);
    const south = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * (180 / Math.PI);
    
    return {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]]
    };
  };
  
  onMount(() => {
    const initialMap = new maplibregl.Map({
      container: mapContainer,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{
          id: 'osm-tiles',
          type: 'raster',
          source: 'osm',
          minzoom: 0,
          maxzoom: 19
        }]
      },
      center: [14.9, 47.1],  // Center of Austria
      zoom: 7
    });
    
    setMap(initialMap);
    fetchTileStatus();
  });
  
  createEffect(() => {
    mode();  // Track mode changes
    since(); // Track date changes
    updateTileLayers();
  });
  
  return (
    <div class="container">
      <div class="controls">
        <select value={mode()} onInput={(e) => setMode(e.target.value)}>
          <option value="all">All Tiles</option>
          <option value="scraped">Scraped Tiles</option>
          <option value="missing">Missing Tiles</option>
          <option value="updated">Updated Tiles</option>
        </select>
        
        <input 
          type="date" 
          value={since()} 
          onInput={(e) => setSince(e.target.value)}
        />
        
        <button onClick={fetchTileStatus}>Refresh</button>
      </div>
      
      <div class="map" ref={mapContainer}></div>
      
      <div class="legend">
        <div class="legend-item">
          <div class="color-box scraped"></div>
          <span>Scraped Tiles</span>
        </div>
        <div class="legend-item">
          <div class="color-box missing"></div>
          <span>Missing Tiles</span>
        </div>
        <div class="legend-item">
          <div class="color-box updated"></div>
          <span>Updated Tiles</span>
        </div>
      </div>
    </div>
  );
};

render(() => <App />, document.getElementById('root'));
