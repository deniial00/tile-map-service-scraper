import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { StatusPanel } from '../components/Dashboard/StatusPanel'
import { ControlPanel } from '../components/Dashboard/ControlPanel'
import { Statistics } from '../components/Dashboard/Statistics'

export function Dashboard() {
  const { status, fetchStatus } = useStore()

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  return (
    <div className="space-y-6">
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            Dashboard
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StatusPanel status={status} />
        <ControlPanel />
      </div>

      <Statistics status={status} />
    </div>
  )
} 