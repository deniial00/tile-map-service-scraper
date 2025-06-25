import { useEffect } from 'react'
import { useStore } from '../store/useStore'

export function Settings() {
  const { settings, fetchSettings, updateSettings } = useStore()

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      await updateSettings(settings)
    } catch (error) {
      console.error('Failed to update settings:', error)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target
    updateSettings({
      [name]: type === 'number' ? parseInt(value) : value,
    })
  }

  return (
    <div className="space-y-6">
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            Settings
          </h2>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 divide-y divide-gray-200">
        <div className="space-y-8 divide-y divide-gray-200">
          <div className="pt-8">
            <div className="mt-6 grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
              <div className="sm:col-span-3">
                <label htmlFor="batchSize" className="block text-sm font-medium text-gray-700">
                  Batch Size
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    name="batchSize"
                    id="batchSize"
                    value={settings.batchSize}
                    onChange={handleChange}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="minQueueSize" className="block text-sm font-medium text-gray-700">
                  Minimum Queue Size
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    name="minQueueSize"
                    id="minQueueSize"
                    value={settings.minQueueSize}
                    onChange={handleChange}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="updateInterval" className="block text-sm font-medium text-gray-700">
                  Update Interval (hours)
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    name="updateInterval"
                    id="updateInterval"
                    value={settings.updateInterval}
                    onChange={handleChange}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="requestDelay" className="block text-sm font-medium text-gray-700">
                  Request Delay (ms)
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    name="requestDelay"
                    id="requestDelay"
                    value={settings.requestDelay}
                    onChange={handleChange}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-5">
          <div className="flex justify-end">
            <button
              type="submit"
              className="ml-3 inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
} 