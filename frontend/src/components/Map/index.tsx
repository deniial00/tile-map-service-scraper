import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useNavigate } from 'react-router-dom';

const Map: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const [tooltip, setTooltip] = useState<{ properties: any; coordinates: [number, number] } | null>(null);
    const hoveredFeatureId = useRef<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!mapContainer.current) return;

        // Initialize the map
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: {
                version: 8,
                sources: {
                    'bmap': {
                        type: 'raster',
                        tiles: ['https://mapsneu.wien.gv.at/basemap/bmaphidpi/normal/google3857/{z}/{y}/{x}.jpeg'],
                        tileSize: 256,
                        attribution: 'Grundkarte: © basemap.at'
                    },
                    'kataster': {
                        type: 'vector',
                        tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}.pbf`],
                        minzoom: 10,
                        maxzoom: 19,
                        attribution: 'Kataster: © BEV'
                    },
                    // 'bbox': {
                    //     type: 'vector',
                    //     tiles: [`${window.location.origin}/api/tiles/bbox/{z}/{x}/{y}.pbf`],
                    //     minzoom: 10,
                    //     maxzoom: 19,
                    //     attribution: 'BBox: tile borders'
                    // }
                },
                layers: [
                    {
                        id: 'basemap',
                        type: 'raster',
                        source: 'bmap',
                        minzoom: 0,
                        maxzoom: 19
                    },
                    {
                        id: 'kataster-parcels',
                        type: 'fill',
                        source: 'kataster',
                        'source-layer': 'gst',
                        paint: {
                            'fill-color': '#ff0000',
                            'fill-opacity': 0.3
                        }
                    },
                    {
                        id: 'kataster-lines',
                        type: 'line',
                        source: 'kataster',
                        'source-layer': 'gst',
                        paint: {
                            'line-color': '#ff0000',
                            'line-width': 1,
                            'line-opacity': 0.8
                        }
                    },
                    {
                        id: 'hovered-parcel',
                        type: 'fill',
                        source: 'kataster',
                        'source-layer': 'gst',
                        paint: {
                            'fill-color': '#00ff00', // Highlight color for hovered parcel
                            'fill-opacity': 0.5
                        },
                        filter: ['==', 'id', ''] // Initially empty filter
                    },
                    // {
                    //     id: 'bbox-border',
                    //     type: 'line',
                    //     source: 'bbox',
                    //     'source-layer': 'bbox',
                    //     paint: {
                    //         'line-color': '#0000ff',
                    //         'line-width': 2,
                    //         'line-opacity': 0.7
                    //     }
                    // },
                    // {
                    //     id: 'bbox-label',
                    //     type: 'symbol',
                    //     source: 'bbox',
                    //     'source-layer': 'bbox',
                    //     layout: {
                    //         'text-field': ['get', 'layer'],
                    //         'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    //         'text-size': 12,
                    //         'text-anchor': 'top-left',
                    //         'text-offset': [0.5, 0.5]
                    //     },
                    //     paint: {
                    //         'text-color': '#0000ff',
                    //         'text-halo-color': '#fff',
                    //         'text-halo-width': 1
                    //     }
                    // }
                ]
            },
            center: [16.3738, 48.2082], // Vienna coordinates
            zoom: 15,
            maxZoom: 19
        });

        // Add navigation control
        map.current.addControl(new maplibregl.NavigationControl());

        // Mouse move event to display feature properties and change fill style
        map.current.on('mouseover', 'kataster-parcels', (e) => {
            if (e.features && e.features.length > 0) {
                const feature = e.features[0];
                const featureId = `${feature.properties.kgnr}_${feature.properties.gnr}`;
                setTooltip({
                    properties: feature.properties,
                    coordinates: e.lngLat.toArray() as [number, number]
                });

                // Change fill style on hover
                if (hoveredFeatureId.current !== featureId) {
                    hoveredFeatureId.current = featureId;
                    // Set filter to highlight only the hovered parcel
                    map.current?.setFilter('hovered-parcel', ['==', 'id', featureId as string]); // Assuming 'id' is the unique identifier
                }
            } else {
                setTooltip(null);
                // Reset fill style when not hovering
                if (hoveredFeatureId.current) {
                    hoveredFeatureId.current = null;
                    map.current?.setFilter('hovered-parcel', ['==', 'id', '']); // Reset filter to show no highlighted features
                }
            }
        });

        // Click event to open PbfViewer
        map.current.on('click', 'kataster-parcels', (e) => {
            // Only allow for z=15
            const z = 15;
            if (e.features && e.features.length > 0) {
                const lng = e.lngLat.lng;
                const lat = e.lngLat.lat;
                // Helper to convert lng/lat to tile x/y
                function lngLatToTile(lon: number, lat: number, zoom: number) {
                    const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
                    const y = Math.floor(
                        (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
                        2 * Math.pow(2, zoom)
                    );
                    return { x, y };
                }
                const { x, y } = lngLatToTile(lng, lat, z);
                navigate(`/pbf-viewer/${z}/${x}/${y}`);
            }
        });

        // Cleanup
        return () => {
            if (map.current) {
                map.current.remove();
            }
        };
    }, [navigate]); // Only run once on mount

    return (
        <div 
            ref={mapContainer} 
            className="w-full h-full rounded-lg shadow-lg"
            style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}
        >
            {tooltip && (
                <div 
                    className="tooltip" 
                    style={{ position: 'absolute', left: tooltip.coordinates[0], top: tooltip.coordinates[1], background: 'white', padding: '5px', border: '1px solid black' }}
                >
                    <pre>{JSON.stringify(tooltip.properties, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

export default Map; 