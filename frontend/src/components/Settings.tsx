import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { Settings as SettingsType } from '../types/settings';

export function Settings() {
  const { settings, fetchSettings, updateSettings, isLoading, error } = useStore();
  const [localSettings, setLocalSettings] = useState<SettingsType>(settings);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setLocalSettings(prev => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateSettings(localSettings);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-4">Loading settings...</div>;
  }

  if (error) {
    return <div className="p-4 text-destructive">{error}</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Scraper Settings</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Batch Size
              <input
                type="number"
                name="batchSize"
                value={localSettings.batchSize}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>
          
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Min Queue Size
              <input
                type="number"
                name="minQueueSize"
                value={localSettings.minQueueSize}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Max Tiles to Process
              <input
                type="number"
                name="maxTilesToProcess"
                value={localSettings.maxTilesToProcess}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Update Interval (hours)
              <input
                type="number"
                name="updateInterval"
                value={localSettings.updateInterval}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Min Zoom
              <input
                type="number"
                name="minZoom"
                value={localSettings.minZoom}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Max Zoom
              <input
                type="number"
                name="maxZoom"
                value={localSettings.maxZoom}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Request Delay (ms)
              <input
                type="number"
                name="requestDelay"
                value={localSettings.requestDelay}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-input bg-background px-3 py-2"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
} 