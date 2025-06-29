export interface Settings {
  batchSize: number;
  minQueueSize: number;
  maxTilesToProcess: number;
  updateInterval: number;
  minZoom: number;
  maxZoom: number;
  zoomLevels: number[];
  requestDelay: number;
} 