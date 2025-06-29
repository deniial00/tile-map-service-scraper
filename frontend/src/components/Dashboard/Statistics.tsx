import type { ScraperStatus } from '../../store/useStore'

interface StatisticsProps {
  status: ScraperStatus
}

export function Statistics({ status }: StatisticsProps) {
  const { stats } = status

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="p-6">
        <h3 className="text-base font-semibold leading-6 text-gray-900">Statistics</h3>
        <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
            <dt className="truncate text-sm font-medium text-gray-500">Total Tiles</dt>
            <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
              {stats.totalTiles}
            </dd>
          </div>

          <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
            <dt className="truncate text-sm font-medium text-gray-500">Processed Tiles</dt>
            <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
              {stats.processedTiles}
            </dd>
          </div>

          <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
            <dt className="truncate text-sm font-medium text-gray-500">Updated Tiles</dt>
            <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
              {stats.updatedTiles}
            </dd>
          </div>

          {status.initializationProgress && (
            <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
              <dt className="truncate text-sm font-medium text-gray-500">Duration</dt>
              <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
                {Math.floor(status.initializationProgress.duration / 60)}m {Math.floor(status.initializationProgress.duration % 60)}s
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
} 