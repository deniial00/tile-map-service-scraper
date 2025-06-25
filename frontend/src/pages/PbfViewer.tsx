import React, { useState, useEffect } from 'react';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { useParams } from 'react-router-dom';

function featureMatchesSearch(feature: any, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return Object.values(feature.properties || {}).some(v => String(v).toLowerCase().includes(q));
}

function getFeatureBBox(feature: any) {
  // Returns [minX, minY, maxX, maxY]
  if (!feature.geometry || !feature.geometry.coordinates) return [0,0,1,1];
  let coords = feature.geometry.type === 'Polygon'
    ? (feature.geometry.coordinates.flat(1) as any[])
    : feature.geometry.type === 'MultiPolygon'
      ? (feature.geometry.coordinates.flat(2) as any[])
      : [];
  let xs = coords.map((c: any) => c[0]);
  let ys = coords.map((c: any) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function renderFeatureSVG(feature: any, size = 120) {
  if (!feature.geometry || !feature.geometry.coordinates) return null;
  const [minX, minY, maxX, maxY] = getFeatureBBox(feature);
  const scale = Math.min(size / (maxX - minX || 1), size / (maxY - minY || 1)) * 0.9;
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  let paths: string[] = [];
  if (feature.geometry.type === 'Polygon') {
    paths = (feature.geometry.coordinates as any[]).map((ring: any) =>
      'M' + (ring as any[]).map(([x, y]: [number, number]) => `${(x - minX) * scale + offsetX},${size - ((y - minY) * scale + offsetY)}`).join('L') + 'Z'
    );
  } else if (feature.geometry.type === 'MultiPolygon') {
    paths = (feature.geometry.coordinates as any[]).flat().map((ring: any) =>
      'M' + (ring as any[]).map(([x, y]: [number, number]) => `${(x - minX) * scale + offsetX},${size - ((y - minY) * scale + offsetY)}`).join('L') + 'Z'
    );
  }
  return (
    <svg width={size} height={size} style={{background:'#f8f8f8', border:'1px solid #ddd', borderRadius:8}}>
      {paths.map((d: string, i: number) => <path key={i} d={d} fill="#ff000055" stroke="#ff0000" strokeWidth={1} />)}
    </svg>
  );
}

const PbfViewer: React.FC = () => {
  const params = useParams<{ z?: string; x?: string; y?: string }>();
  const [z, setZ] = useState(params.z ? Number(params.z) : 15);
  const [x, setX] = useState(params.x ? Number(params.x) : 17875);
  const [y, setY] = useState(params.y ? Number(params.y) : 11361);
  const [decodedData, setDecodedData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchTile = async (zVal = z, xVal = x, yVal = y) => {
    setError(null);
    setDecodedData(null);
    setLoading(true);
    try {
      if (zVal !== 15) throw new Error('Only zoom level 15 is supported.');
      const url = `/api/tiles/${zVal}/${xVal}/${yVal}.pbf`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch tile: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      // Decode PBF
      const tile = new VectorTile(new Pbf(arrayBuffer));
      // Convert layers to JSON
      const decoded: any = {};
      for (const layerName in tile.layers) {
        const layer = tile.layers[layerName];
        decoded[layerName] = [];
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          decoded[layerName].push(feature.toGeoJSON(xVal, yVal, zVal));
        }
      }
      setDecodedData(decoded.gst);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when z/x/y change (from URL)
  useEffect(() => {
    if (params.z && params.x && params.y) {
      const zVal = Number(params.z);
      const xVal = Number(params.x);
      const yVal = Number(params.y);
      setZ(zVal);
      setX(xVal);
      setY(yVal);
      fetchTile(zVal, xVal, yVal);
    }
  }, [params.z, params.x, params.y]);

  const filteredFeatures = (decodedData || []).filter((f: any) => featureMatchesSearch(f, search));

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">PBF Viewer</h2>
      <div className="mb-4 flex gap-2 items-end">
        <div>
          <label className="block text-sm">Z</label>
          <input type="number" value={z} onChange={e => setZ(Number(e.target.value))} className="border p-1 w-16" />
        </div>
        <div>
          <label className="block text-sm">X</label>
          <input type="number" value={x} onChange={e => setX(Number(e.target.value))} className="border p-1 w-24" />
        </div>
        <div>
          <label className="block text-sm">Y</label>
          <input type="number" value={y} onChange={e => setY(Number(e.target.value))} className="border p-1 w-24" />
        </div>
        <button onClick={() => fetchTile()} className="bg-blue-600 text-white px-4 py-2 rounded">Fetch Tile</button>
        <input
          type="text"
          placeholder="Search properties..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border p-1 ml-4 flex-1 min-w-[200px] rounded"
        />
      </div>
      {loading && <div>Loading...</div>}
      {error && <div className="text-red-600">Error: {error}</div>}
      {filteredFeatures && filteredFeatures.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFeatures.map((feature: any, i: number) => (
            <div key={i} className="bg-white rounded shadow p-4 flex flex-col items-center">
              {renderFeatureSVG(feature)}
              <pre className="w-full overflow-x-auto bg-gray-100 p-2 text-xs rounded mt-2" style={{maxHeight: 200, overflowY: 'auto'}}>{JSON.stringify(feature.properties, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
      {filteredFeatures && filteredFeatures.length === 0 && !loading && <div>No features found.</div>}
    </div>
  );
};

export default PbfViewer; 