import { Routes, Route, Link } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import { Settings } from './components/Settings'
import MapView from './pages/MapView'
import PbfViewer from './pages/PbfViewer'

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card p-4 shadow-sm">
        <div className="container mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">TMSS</h1>
          <div className="space-x-4">
            <Link 
              to="/" 
              className="text-foreground hover:text-primary transition-colors"
            >
              Dashboard
            </Link>
            <Link 
              to="/map" 
              className="text-foreground hover:text-primary transition-colors"
            >
              Map
            </Link>
            <Link 
              to="/pbf-viewer" 
              className="text-foreground hover:text-primary transition-colors"
            >
              PBF Viewer
            </Link>
            <Link 
              to="/settings" 
              className="text-foreground hover:text-primary transition-colors"
            >
              Settings
            </Link>
          </div>
        </div>
      </nav>

      <main className="container mx-auto py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/pbf-viewer/:z?/:x?/:y?" element={<PbfViewer />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
} 