import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import type { GtRound } from '../api'

const SPARKLINE_COLORS: Record<string, string> = {
  sg_off_tee: '#22c55e',
  sg_approach: '#3b82f6',
  sg_around_green: '#f59e0b',
  sg_putting: '#a855f7',
}

const SCORE_LINE_COLOR = '#38bdf8'
const ROLLING_AVG_LINE_COLOR = '#f97316'
const SCORING_TREND_HEIGHT = 200

interface RollingAvgPoint {
  label: string
  score: number
  rollingAvg: number
}

function sgColor(v: number | null) {
  if (v == null) return 'text-slate-400'
  if (v > 0.3) return 'text-green-400'
  if (v > 0) return 'text-green-300'
  if (v > -0.3) return 'text-red-300'
  return 'text-red-400'
}

function sgFmt(v: number | null) {
  if (v == null) return '—'
  return (v >= 0 ? '+' : '') + v.toFixed(2)
}

function fmtDate(d: string) {
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function scoreFmt(score: number, par: number) {
  const diff = score - par
  if (diff === 0) return { label: `${score} (E)`, cls: 'text-slate-200' }
  if (diff < 0) return { label: `${score} (${diff})`, cls: 'text-green-400' }
  return { label: `${score} (+${diff})`, cls: 'text-red-400' }
}

export default function Rounds() {
  const [rounds, setRounds] = useState<GtRound[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'scored' | 'practice'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  function load() {
    api.gtRounds().then(setRounds).catch(() => setRounds([]))
  }

  useEffect(() => { load() }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const res = await api.gtIngest(file)
      if (res.ok) {
        setUploadMsg(`Imported ${res.rounds} rounds, ${res.holes} holes, ${res.shots} shots.`)
        load()
      } else {
        setUploadMsg(`Error: ${res.detail ?? 'unknown error'}`)
      }
    } catch {
      setUploadMsg('Upload failed — check that the API is running.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const filtered = rounds.filter((r) => {
    if (filter === 'practice') return r.is_practice
    if (filter === 'scored') return !r.is_practice
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo && r.date > dateTo) return false
    return true
  })

  const scoringTrendData = useMemo((): RollingAvgPoint[] => {
    const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date))
    return sorted.map((r, i) => {
      const window = sorted.slice(Math.max(0, i - 4), i + 1)
      const avg = window.reduce((sum, w) => sum + w.total_score, 0) / window.length
      const dt = new Date(r.date)
      const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return { label, score: r.total_score, rollingAvg: Math.round(avg * 10) / 10 }
    })
  }, [filtered])

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-white">On-Course Rounds</h1>

        <div className="flex gap-2">
          {(['all', 'scored', 'practice'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm capitalize ${
                filter === f ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {f === 'scored' ? 'Competitive' : f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500"
          />
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {uploadMsg && (
            <span className={`text-xs ${uploadMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {uploadMsg}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium"
          >
            {uploading ? 'Uploading…' : '↑ Upload JSON'}
          </button>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-lg mb-2">No round data yet</p>
          <p className="text-sm">Upload your golf tracker JSON export using the button above.</p>
        </div>
      ) : (
        <>
          {/* SG summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Off Tee', key: 'sg_off_tee' as const },
              { label: 'Approach', key: 'sg_approach' as const },
              { label: 'Around Green', key: 'sg_around_green' as const },
              { label: 'Putting', key: 'sg_putting' as const },
            ].map(({ label, key }) => {
              const chronological = [...filtered].sort((a, b) => a.date.localeCompare(b.date))
              const sparkData = chronological.map((r) => ({ v: r[key] ?? undefined }))
              const vals = filtered.map((r) => r[key]).filter((v): v is number => v != null)
              const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
              const color = SPARKLINE_COLORS[key]
              return (
                <div key={key} className="bg-slate-800 rounded-lg p-4">
                  <div className="text-slate-400 text-xs mb-1">Avg SG: {label}</div>
                  <div className={`text-xl font-bold ${sgColor(avg)}`}>{sgFmt(avg)}</div>
                  <LineChart width={120} height={40} data={sparkData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </LineChart>
                </div>
              )
            })}
          </div>

          {/* Scoring trend */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-200">Scoring Trend</h2>
              <span className="text-xs text-slate-500">Lower is better</span>
            </div>
            <ResponsiveContainer width="100%" height={SCORING_TREND_HEIGHT}>
              <LineChart data={scoringTrendData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  domain={['auto', 'auto']}
                  reversed={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: '#cbd5e1' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Line
                  type="monotone"
                  dataKey="score"
                  name="Score"
                  stroke={SCORE_LINE_COLOR}
                  dot={{ r: 3, fill: SCORE_LINE_COLOR }}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="rollingAvg"
                  name="5-Round Avg"
                  stroke={ROLLING_AVG_LINE_COLOR}
                  dot={false}
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400 text-left text-xs">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Tees</th>
                  <th className="px-4 py-3 text-center">Holes</th>
                  <th className="px-4 py-3 text-right">Score</th>
                  <th className="px-4 py-3 text-right">Putts</th>
                  <th className="px-4 py-3 text-right">SG: Tee</th>
                  <th className="px-4 py-3 text-right">SG: App</th>
                  <th className="px-4 py-3 text-right">SG: AG</th>
                  <th className="px-4 py-3 text-right">SG: Putt</th>
                  <th className="px-4 py-3 text-right">SG: Total</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const { label, cls } = scoreFmt(r.total_score, r.total_par)
                  return (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/rounds/${r.id}`)}
                      className={`cursor-pointer hover:bg-slate-800 transition-colors ${
                        i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-white whitespace-nowrap">
                        {fmtDate(r.date)}
                        {r.is_practice && (
                          <span className="ml-2 text-xs text-slate-500 italic">practice</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-200 whitespace-nowrap">
                        {r.course_name}
                        <span className="ml-1 text-slate-500 text-xs">{r.course_city}, {r.course_state}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">
                        {r.tee_name} ({r.rating}/{r.slope})
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-300">{r.total_holes}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${cls}`}>{label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-300">{r.total_putts}</td>
                      <td className={`px-4 py-2.5 text-right ${sgColor(r.sg_off_tee)}`}>{sgFmt(r.sg_off_tee)}</td>
                      <td className={`px-4 py-2.5 text-right ${sgColor(r.sg_approach)}`}>{sgFmt(r.sg_approach)}</td>
                      <td className={`px-4 py-2.5 text-right ${sgColor(r.sg_around_green)}`}>{sgFmt(r.sg_around_green)}</td>
                      <td className={`px-4 py-2.5 text-right ${sgColor(r.sg_putting)}`}>{sgFmt(r.sg_putting)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${sgColor(r.strokes_gained)}`}>{sgFmt(r.strokes_gained)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
