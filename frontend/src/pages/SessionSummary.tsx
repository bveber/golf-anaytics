import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Session, Shot } from '../api'

type SortDir = 'asc' | 'desc'
interface SortState { key: string; dir: SortDir }

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block ${active ? 'text-green-400' : 'text-slate-600'}`}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  )
}

const METRICS: { key: keyof Shot; label: string; unit: string }[] = [
  { key: 'carry_distance', label: 'Carry', unit: 'yds' },
  { key: 'total_distance', label: 'Total', unit: 'yds' },
  { key: 'ball_speed', label: 'Ball Speed', unit: 'mph' },
  { key: 'club_speed', label: 'Club Speed', unit: 'mph' },
  { key: 'smash_factor', label: 'Smash', unit: '' },
  { key: 'launch_angle', label: 'Launch Ang.', unit: '°' },
  { key: 'launch_direction', label: 'Launch Dir.', unit: '°' },
  { key: 'spin_rate', label: 'Spin', unit: 'rpm' },
  { key: 'spin_axis', label: 'Spin Axis', unit: '°' },
  { key: 'side_carry', label: 'Side Carry', unit: 'yds' },
  { key: 'apex', label: 'Apex', unit: 'yds' },
  { key: 'attack_angle', label: 'Attack Ang.', unit: '°' },
  { key: 'club_path', label: 'Club Path', unit: '°' },
]

function fmt(v: number | null, unit: string) {
  if (v == null) return '—'
  return `${v.toFixed(1)}${unit}`
}

export default function SessionSummary() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [sort, setSort] = useState<SortState>({ key: 'shot_number', dir: 'asc' })

  const toggleSort = (key: string) =>
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const sortedShots = useMemo(() => {
    const { key, dir } = sort
    return [...shots].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[key]
      const bv = (b as unknown as Record<string, unknown>)[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }, [shots, sort])

  useEffect(() => {
    if (!id) return
    api.session(id).then(setSession)
    api.shotsForSession(id).then(setShots)
  }, [id])

  async function toggleOutlier(shot: Shot) {
    const newVal = !shot.is_outlier
    await api.updateOutlier(shot.shot_id, newVal, shot.outlier_note ?? undefined)
    setShots((prev) =>
      prev.map((s) => (s.shot_id === shot.shot_id ? { ...s, is_outlier: newVal } : s))
    )
  }

  async function saveNote(shot: Shot) {
    await api.updateOutlier(shot.shot_id, shot.is_outlier, noteText || undefined)
    setShots((prev) =>
      prev.map((s) =>
        s.shot_id === shot.shot_id ? { ...s, outlier_note: noteText || null } : s
      )
    )
    setEditing(null)
  }

  const date = session?.session_date
    ? new Date(session.session_date).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : '—'

  return (
    <div>
      <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white text-sm mb-4">
        ← Back
      </button>

      {session && (
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{date}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {session.session_type} · {shots.length} shots
            </p>
          </div>
          <button
            onClick={() => navigate(`/session/${id}/clubs`)}
            className="px-3 py-1.5 rounded text-sm bg-slate-700 text-slate-300 hover:bg-green-800 hover:text-white transition-colors"
          >
            By Club →
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-xs">
          <thead className="bg-slate-800 text-slate-400 text-left">
            <tr>
              {([
                { key: 'shot_number', label: '#' },
                { key: 'club_type', label: 'Club' },
                ...METRICS.map((m) => ({ key: m.key as string, label: m.label })),
              ] as { key: string; label: string }[]).map(({ key, label }) => (
                <th
                  key={key}
                  className="px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:text-slate-200"
                  onClick={() => toggleSort(key)}
                >
                  {label}<SortIcon active={sort.key === key} dir={sort.dir} />
                </th>
              ))}
              <th className="px-3 py-2">Outlier</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {sortedShots.map((shot, i) => (
              <tr
                key={shot.shot_id}
                className={`transition-colors ${
                  shot.is_outlier
                    ? 'bg-red-950 text-red-300'
                    : i % 2 === 0
                    ? 'bg-slate-900 text-slate-200'
                    : 'bg-slate-950 text-slate-200'
                }`}
              >
                <td className="px-3 py-1.5 text-slate-500">{shot.shot_number}</td>
                <td className="px-3 py-1.5 whitespace-nowrap font-medium">{shot.club_type ?? '—'}</td>
                {METRICS.map((m) => (
                  <td key={m.key} className="px-3 py-1.5 text-right">
                    {fmt(shot[m.key] as number | null, m.unit)}
                  </td>
                ))}
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => toggleOutlier(shot)}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      shot.is_outlier
                        ? 'bg-red-800 text-red-200 hover:bg-red-700'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    }`}
                  >
                    {shot.is_outlier ? 'Outlier' : 'Flag'}
                  </button>
                </td>
                <td className="px-3 py-1.5">
                  {editing === shot.shot_id ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        className="bg-slate-700 text-white rounded px-2 py-0.5 text-xs w-32"
                        placeholder="reason..."
                      />
                      <button onClick={() => saveNote(shot)} className="text-green-400 text-xs">✓</button>
                      <button onClick={() => setEditing(null)} className="text-slate-400 text-xs">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditing(shot.shot_id); setNoteText(shot.outlier_note ?? '') }}
                      className="text-slate-500 hover:text-slate-300 text-xs"
                    >
                      {shot.outlier_note ?? '+'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
