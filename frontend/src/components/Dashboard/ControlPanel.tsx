import { useStore } from '../../store/useStore'
import { PlayIcon, StopIcon } from '@heroicons/react/24/outline'

export function ControlPanel() {
  const { status, startScraping, stopScraping, initScraper } = useStore()
  const isRunning = status.isRunning

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="p-6">
        <h3 className="text-base font-semibold leading-6 text-gray-900">Controls</h3>
        <div className="mt-5 flex gap-4">
          <button
            type="button"
            onClick={() => initScraper()}
            disabled={isRunning}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Initialize Tiles
          </button>

          <button
            type="button"
            onClick={isRunning ? stopScraping : startScraping}
            className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              isRunning
                ? 'bg-red-600 hover:bg-red-500 focus-visible:outline-red-600'
                : 'bg-green-600 hover:bg-green-500 focus-visible:outline-green-600'
            }`}
          >
            {isRunning ? (
              <>
                <StopIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                Stop Scraping
              </>
            ) : (
              <>
                <PlayIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                Start Scraping
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
} 