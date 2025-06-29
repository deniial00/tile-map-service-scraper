import { useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { Statistics } from './Statistics'
import { StatusPanel } from './StatusPanel'
import { ControlPanel } from './ControlPanel'

function Dashboard() {
  const { status, fetchStatus, isLoading } = useStore()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Fetch status when the component mounts
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    // Start the interval only if not loading
    if (!isLoading) {
      intervalRef.current = setInterval(() => {
        fetchStatus()
      }, 5000)
    }

    return () => {
      // Clear the interval when the component unmounts or when loading state changes
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isLoading, fetchStatus])

  return (
    <div className="py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-gray-900">
          Dashboard
        </h1>
        <div className="mt-8 grid grid-cols-1 gap-6">
          <StatusPanel status={status} />
          <Statistics status={status} />
          <ControlPanel />
        </div>
      </div>
    </div>
  )
}

export default Dashboard 