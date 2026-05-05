import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Session } from '../api'

const SESSION_TYPE_LABELS: Record<string, string> = {
  practice: 'Practice',
  combines: 'Combine',
  range: 'Range',
  target: 'Target Range',
  closesttopin: 'Closest to Pin',
  speed: 'Speed',
  courses: 'Courses',
}

const TYPE_COLORS: Record<string, string> = {
  practice: 'bg-blue-900 text-blue-200',
  combines: 'bg-purple-900 text-purple-200',
  range: 'bg-green-900 text-green-200',
  target: 'bg-yellow-900 text-yellow-200',
  closesttopin: 'bg-orange-900 text-orange-200',
  speed: 'bg-red-900 text-red-200',
  courses: 'bg-teal-900 text-teal-200',
}

function fmt(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function SessionBrowser() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [filter, setFilter] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.sessions().then(setSessions)
  }, [])

  const filtered = filter
    ? sessions.filter((s) => s.session_type === filter)
    : sessions

  const types = Array.from(new Set(sessions.map((s) => s.session_type).filter(Boolean))) as string[]

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white">Sessions</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('')}
            className={`px-3 py-1 rounded text-sm ${filter === '' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            All
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t === filter ? '' : t)}
              className={`px-3 py-1 rounded text-sm ${filter === t ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {SESSION_TYPE_LABELS[t] ?? t}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Shots</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr
                key={s.session_id}
                onClick={() => navigate(`/session/${s.session_id}`)}
                className={`cursor-pointer hover:bg-slate-800 transition-colors ${
                  i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'
                }`}
              >
                <td className="px-4 py-3 font-medium text-white">{fmt(s.session_date)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[s.session_type ?? ''] ?? 'bg-slate-700 text-slate-300'}`}>
                    {SESSION_TYPE_LABELS[s.session_type ?? ''] ?? s.session_type ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">{s.shot_count ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400 italic">{s.notes ?? ''}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => navigate(`/session/${s.session_id}/clubs`)}
                    className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300 hover:bg-green-800 hover:text-white transition-colors"
                  >
                    By Club
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
