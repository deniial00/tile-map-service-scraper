import { create } from 'zustand'
import type { Settings } from '../types/settings'
import * as api from '../services/api'

export interface ScraperStats {
  totalTiles: number;
  processedTiles: number;
  updatedTiles: number;
  currentZoom: number | null;
  lastUpdate: Date;
  initializationStartTime: Date | null;
  initializationEndTime: Date | null;
}

export interface InitializationProgress {
  startTime: Date;
  duration: number;
  processedTiles: number;
  totalTiles: number;
  currentZoom: number | null;
}

export interface ScraperStatus {
  isInitialized: boolean;
  isRunning: boolean;
  currentOperation: string | null;
  stats: ScraperStats;
  initializationProgress?: InitializationProgress;
}

interface Store {
  status: ScraperStatus;
  settings: Settings;
  isLoading: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
  initScraper: () => Promise<void>;
  startScraping: () => Promise<void>;
  stopScraping: () => Promise<void>;
}

const defaultStats: ScraperStats = {
  totalTiles: 0,
  processedTiles: 0,
  updatedTiles: 0,
  currentZoom: null,
  lastUpdate: new Date(),
  initializationStartTime: null,
  initializationEndTime: null,
};

const defaultStatus: ScraperStatus = {
  isInitialized: false,
  isRunning: false,
  currentOperation: null,
  stats: defaultStats,
};

const defaultSettings: Settings = {
  batchSize: 1000,
  minQueueSize: 100,
  maxTilesToProcess: 0,
  updateInterval: 24,
  minZoom: 10,
  maxZoom: 16,
  zoomLevels: [],
  requestDelay: 500,
};

export const useStore = create<Store>((set, get) => ({
  status: defaultStatus,
  settings: defaultSettings,
  isLoading: false,
  error: null,

  fetchStatus: async () => {
    try {
      set({ isLoading: true, error: null });
      const status = await api.getStatus();
      set({ status });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch status' });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchSettings: async () => {
    try {
      set({ isLoading: true, error: null });
      const settings = await api.getSettings();
      set({ settings });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch settings' });
    } finally {
      set({ isLoading: false });
    }
  },

  updateSettings: async (newSettings) => {
    try {
      set({ isLoading: true, error: null });
      const settings = await api.updateSettings(newSettings);
      set({ settings });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update settings' });
    } finally {
      set({ isLoading: false });
    }
  },

  initScraper: async () => {
    try {
      set({ isLoading: true, error: null });
      await api.initScraper();
      await get().fetchStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to initialize scraper' });
    } finally {
      set({ isLoading: false });
    }
  },

  startScraping: async () => {
    try {
      set({ isLoading: true, error: null });
      await api.startScraping();
      await get().fetchStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to start scraping' });
    } finally {
      set({ isLoading: false });
    }
  },

  stopScraping: async () => {
    try {
      set({ isLoading: true, error: null });
      await api.stopScraping();
      await get().fetchStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to stop scraping' });
    } finally {
      set({ isLoading: false });
    }
  },
})) 