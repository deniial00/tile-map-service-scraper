import { CheckCircleIcon } from '@heroicons/react/24/outline'
import type { ScraperStatus } from '../../store/useStore'

interface StatusPanelProps {
  status: ScraperStatus
}

export function StatusPanel({ status }: StatusPanelProps) {
  const { isRunning, currentOperation } = status

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            {isRunning ? (
              <CheckCircleIcon className="h-8 w-8 text-green-400" aria-hidden="true" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-gray-100" />
            )}
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="truncate text-sm font-medium text-gray-500">Status</dt>
              <dd className="flex items-baseline">
                <div className="text-2xl font-semibold text-gray-900">
                  {currentOperation
                    ? currentOperation.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                    : 'Idle'}
                </div>
              </dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="bg-gray-50 px-6 py-3">
        <div className="text-sm">
          <div className="font-medium text-gray-500">
            {isRunning
              ? 'Scraper is running'
              : 'Scraper is idle'}
          </div>
        </div>
      </div>
    </div>
  )
} 