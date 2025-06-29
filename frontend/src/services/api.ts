import axios from 'axios';
import type { Settings } from '../types/settings';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const getSettings = async (): Promise<Settings> => {
  const response = await api.get<Settings>('/settings');
  return response.data;
};

export const updateSettings = async (settings: Partial<Settings>): Promise<Settings> => {
  const response = await api.post<Settings>('/settings', settings);
  return response.data;
};

export const getStatus = async () => {
  const response = await api.get('/status');
  return response.data;
};

export const initScraper = async () => {
  const response = await api.post('/init?force=true');
  return response.data;
};

export const startScraping = async () => {
  const response = await api.post('/scrape/start');
  return response.data;
};

export const stopScraping = async () => {
  const response = await api.post('/scrape/stop');
  return response.data;
}; 