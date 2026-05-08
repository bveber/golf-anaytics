import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import SessionBrowser from './pages/SessionBrowser'
import SessionSummary from './pages/SessionSummary'
import ClubDashboard from './pages/ClubDashboard'
import Gapping from './pages/Gapping'
import Rounds from './pages/Rounds'
import RoundDetail from './pages/RoundDetail'
import SwingEffort from './pages/SwingEffort'
import WedgeMatrix from './pages/WedgeMatrix'
import Compare from './pages/Compare'
import SessionClubs from './pages/SessionClubs'
import Bag from './pages/Bag'
import { BagProvider } from './BagContext'
import SettingsModal from './components/SettingsModal'

function Nav() {
  const [showSettings, setShowSettings] = useState(false)
  const cls = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded text-sm font-medium transition-colors ${
      isActive ? 'bg-green-700 text-white' : 'text-slate-400 hover:text-white'
    }`
  return (
    <nav className="flex items-center gap-2 px-6 py-3 bg-slate-900 border-b border-slate-700">
      <span className="text-green-400 font-bold text-lg mr-4">⛳ Golf Analytics</span>
      <NavLink to="/" end className={cls}>Sessions</NavLink>
      <NavLink to="/clubs" className={cls}>Clubs</NavLink>
      <NavLink to="/gapping" className={cls}>Gapping</NavLink>
      <NavLink to="/wedge-matrix" className={cls}>Wedge Matrix</NavLink>
      <NavLink to="/swing-effort" className={cls}>Swing Effort</NavLink>
      <NavLink to="/rounds" className={cls}>Rounds</NavLink>
      <NavLink to="/compare" className={cls}>Compare</NavLink>
      <NavLink to="/bag" className={cls}>Bag</NavLink>
      <button onClick={() => setShowSettings(true)} className="ml-auto text-slate-400 hover:text-white text-lg px-2" title="Conditions">⚙</button>
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); window.location.reload() }}
        />
      )}
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <BagProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Nav />
        <div className="p-6">
          <Routes>
            <Route path="/" element={<SessionBrowser />} />
            <Route path="/session/:id" element={<SessionSummary />} />
            <Route path="/session/:id/clubs" element={<SessionClubs />} />
            <Route path="/clubs" element={<ClubDashboard />} />
            <Route path="/gapping" element={<Gapping />} />
            <Route path="/swing-effort" element={<SwingEffort />} />
            <Route path="/wedge-matrix" element={<WedgeMatrix />} />
            <Route path="/rounds" element={<Rounds />} />
            <Route path="/rounds/:id" element={<RoundDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/bag" element={<Bag />} />
          </Routes>
        </div>
      </div>
      </BagProvider>
    </BrowserRouter>
  )
}
