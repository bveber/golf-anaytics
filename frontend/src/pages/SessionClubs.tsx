import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import type { Session, ClubStats, Shot, UserSettings } from '../api'
import { useAdjusted } from '../hooks/useAdjusted'
import AdjustedToggle from '../components/AdjustedToggle'
import AdjustedFootnote from '../components/AdjustedFootnote'
import { computeEllipses } from '../utils/ellipse'

// ── Local types ────────────────────────────────────────────────────────────

interface Point { x: number; y: number }

// ── Metrics ────────────────────────────────────────────────────────────────

const BASE_METRICS: { key: keyof Shot; adjKey: keyof Shot | null; label: string; adjLabel: string; unit: string }[] = [
  { key: 'carry_distance', adjKey: 'carry_distance_adj', label: 'Carry', adjLabel: '~Carry', unit: 'yds' },
  { key: 'total_distance', adjKey: 'total_distance_adj', label: 'Total', adjLabel: '~Total', unit: 'yds' },
  { key: 'ball_speed', adjKey: 'ball_speed_adj', label: 'Ball Speed', adjLabel: '~Ball Speed', unit: 'mph' },
  { key: 'club_speed', adjKey: 'club_speed_adj', label: 'Club Speed', adjLabel: '~Club Speed', unit: 'mph' },
  { key: 'smash_factor', adjKey: null, label: 'Smash', adjLabel: 'Smash', unit: '' },
  { key: 'launch_angle', adjKey: null, label: 'Launch Ang.', adjLabel: 'Launch Ang.', unit: '°' },
  { key: 'launch_direction', adjKey: null, label: 'Launch Dir.', adjLabel: 'Launch Dir.', unit: '°' },
  { key: 'spin_rate', adjKey: null, label: 'Spin', adjLabel: 'Spin', unit: 'rpm' },
  { key: 'spin_axis', adjKey: null, label: 'Spin Axis', adjLabel: 'Spin Axis', unit: '°' },
  { key: 'side_carry', adjKey: null, label: 'Side Carry', adjLabel: 'Side Carry', unit: 'yds' },
  { key: 'apex', adjKey: null, label: 'Apex', adjLabel: 'Apex', unit: 'yds' },
  { key: 'attack_angle', adjKey: null, label: 'Attack Ang.', adjLabel: 'Attack Ang.', unit: '°' },
  { key: 'club_path', adjKey: null, label: 'Club Path', adjLabel: 'Club Path', unit: '°' },
]

function fmtShot(v: number | null, unit: string) {
  if (v == null) return '—'
  return `${v.toFixed(1)}${unit}`
}

// ── Sort helpers ───────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'
interface SortState { key: string; dir: SortDir }

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block ${active ? 'text-green-400' : 'text-slate-600'}`}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 1) {
  if (v == null) return '—'
  return v.toFixed(decimals)
}

function StatCell({
  value, unit = '', decimals = 1,
}: { value: number | null | undefined; unit?: string; decimals?: number }) {
  if (value == null) return <td className="px-4 py-3 text-slate-500 text-center">—</td>
  return (
    <td className="px-4 py-3 text-slate-200 text-center">
      {value.toFixed(decimals)}{unit}
    </td>
  )
}

function CompareCard({
  label, session, historical, unit = '', lowerIsBetter = false,
}: {
  label: string
  session: number | null | undefined
  historical: number | null | undefined
  unit?: string
  lowerIsBetter?: boolean
}) {
  const diff = session != null && historical != null ? session - historical : null
  const better = diff != null && (lowerIsBetter ? diff < 0 : diff > 0)
  const worse = diff != null && (lowerIsBetter ? diff > 0 : diff < 0)

  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="text-slate-400 text-xs mb-2">{label}</div>
      <div className="flex items-end gap-3">
        <div>
          <div className="text-slate-500 text-xs mb-0.5">This session</div>
          <div className="text-white text-lg font-bold">
            {session != null ? `${session.toFixed(1)}${unit}` : '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-xs mb-0.5">All-time</div>
          <div className="text-slate-400 text-lg font-semibold">
            {historical != null ? `${historical.toFixed(1)}${unit}` : '—'}
          </div>
        </div>
        {diff != null && (
          <div className={`text-sm font-medium mb-1 ${better ? 'text-green-400' : worse ? 'text-red-400' : 'text-slate-400'}`}>
            {diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function SessionClubs() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [clubs, setClubs] = useState<ClubStats[]>([])
  const [sessionShots, setSessionShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<UserSettings>({ elevation_ft: 900, temperature_f: 70 })
  const { adjusted, toggleAdjusted } = useAdjusted()

  const [clubSort, setClubSort] = useState<SortState>({ key: 'carry_mean', dir: 'desc' })
  const [editing, setEditing] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const toggleClubSort = (key: string) =>
    setClubSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  const sortedClubs = useMemo(() => {
    const { key, dir } = clubSort
    return [...clubs].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[key]
      const bv = (b as unknown as Record<string, unknown>)[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }, [clubs, clubSort])

  // Selected club dispersion state
  const [selectedClubType, setSelectedClubType] = useState<string | null>(null)
  const [historicalShots, setHistoricalShots] = useState<Shot[]>([])
  const [historicalStats, setHistoricalStats] = useState<ClubStats | null>(null)
  const [loadingDispersion, setLoadingDispersion] = useState(false)
  const [distanceMetric, setDistanceMetric] = useState<'carry' | 'total'>('carry')

  useEffect(() => {
    api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    if (!id) return
    Promise.all([api.session(id), api.sessionClubStats(id), api.shotsForSession(id)]).then(
      ([s, c, shots]) => {
        setSession(s)
        setClubs(c)
        setSessionShots(shots)
        setLoading(false)
      }
    )
  }, [id])

  useEffect(() => {
    if (!selectedClubType) return
    setLoadingDispersion(true)
    Promise.all([
      api.shotsByClub(selectedClubType),
      api.clubStats(),
    ]).then(([shots, allStats]) => {
      setHistoricalShots(shots)
      setHistoricalStats(allStats.find((s) => s.club_type === selectedClubType) ?? null)
      setLoadingDispersion(false)
    })
  }, [selectedClubType])

  async function toggleOutlier(shot: Shot) {
    const newVal = !shot.is_outlier
    await api.updateOutlier(shot.shot_id, newVal, shot.outlier_note ?? undefined)
    setSessionShots((prev) =>
      prev.map((s) => (s.shot_id === shot.shot_id ? { ...s, is_outlier: newVal } : s))
    )
  }

  async function saveNote(shot: Shot) {
    await api.updateOutlier(shot.shot_id, shot.is_outlier, noteText || undefined)
    setSessionShots((prev) =>
      prev.map((s) =>
        s.shot_id === shot.shot_id ? { ...s, outlier_note: noteText || null } : s
      )
    )
    setEditing(null)
  }

  const sessionDate = session?.session_date
    ? new Date(session.session_date).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
    : '—'

  // Dispersion data for selected club
  const yVal = (s: Shot) => {
    if (distanceMetric === 'total') {
      return adjusted ? (s.total_distance_adj ?? s.total_distance) : s.total_distance
    }
    return adjusted ? (s.carry_distance_adj ?? s.carry_distance) : s.carry_distance
  }

  const sessionPts: Point[] = selectedClubType
    ? sessionShots
        .filter((s) => s.club_type === selectedClubType && s.side_carry != null && yVal(s) != null && !s.is_outlier)
        .map((s) => ({ x: s.side_carry!, y: yVal(s)! }))
    : []

  const historicalPts: Point[] = selectedClubType
    ? historicalShots
        .filter((s) => s.session_id !== id && s.side_carry != null && yVal(s) != null && !s.is_outlier)
        .map((s) => ({ x: s.side_carry!, y: yVal(s)! }))
    : []

  const sessionEllipses = computeEllipses(sessionPts)
  const historicalEllipses = computeEllipses(historicalPts)

  // Session stats for selected club
  const sessionClubStats = clubs.find((c) => c.club_type === selectedClubType) ?? null

  // Compute session-only side_carry std and carry std from raw shots
  const sessionClubShots = sessionShots.filter(
    (s) => s.club_type === selectedClubType && !s.is_outlier
  )
  function stdDev(vals: number[]): number | null {
    if (vals.length < 2) return null
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1))
  }
  function mean(vals: number[]): number | null {
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }
  const sessionCarryVals = sessionClubShots.map((s) => s.carry_distance).filter((v): v is number => v != null)
  const sessionTotalVals = sessionClubShots.map((s) => s.total_distance).filter((v): v is number => v != null)
  const sessionCarryMean = mean(sessionCarryVals)
  const sessionTotalMean = mean(sessionTotalVals)
  const sessionCarryStd = stdDev(sessionCarryVals)
  const sessionTotalStd = stdDev(sessionTotalVals)
  const sessionDistStd = distanceMetric === 'total' ? sessionTotalStd : sessionCarryStd

  const historicalClubShots = historicalShots.filter((s) => s.club_type === selectedClubType && !s.is_outlier)
  const historicalTotalMean = mean(historicalClubShots.map((s) => s.total_distance).filter((v): v is number => v != null))
  const sessionSideStd = stdDev(sessionClubShots.map((s) => s.side_carry).filter((v): v is number => v != null))

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{sessionDate}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-slate-400 text-sm capitalize">{session?.session_type ?? ''}</span>
            <Link to={`/session/${id}`} className="text-green-400 hover:text-green-300 text-sm">
              View shot log →
            </Link>
          </div>
        </div>
        <AdjustedToggle adjusted={adjusted} onToggle={toggleAdjusted} />
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : clubs.length === 0 ? (
        <p className="text-slate-400">No club data for this session.</p>
      ) : (
        <>
          <p className="text-slate-500 text-xs mb-3">Click a row to view dispersion for that club.</p>
          <div className="overflow-x-auto rounded-lg border border-slate-700 mb-8">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400 text-left">
                <tr>
                  {([
                    { key: 'club', label: 'Club', center: false },
                    { key: 'shot_count', label: 'Shots', center: true },
                    { key: 'carry_mean', label: 'Carry (yds)', center: true },
                    { key: 'carry_std', label: 'Carry Std', center: true },
                    { key: 'ball_speed_mean', label: adjusted ? '~Ball Speed' : 'Ball Speed', center: true },
                    { key: 'club_speed_mean', label: adjusted ? '~Club Speed' : 'Club Speed', center: true },
                    { key: 'smash_factor_mean', label: 'Smash', center: true },
                    { key: 'spin_rate_mean', label: 'Spin (rpm)', center: true },
                    { key: 'launch_angle_mean', label: 'Launch Ang.', center: true },
                    { key: 'side_carry_std', label: 'Side Std', center: true },
                  ] as { key: string; label: string; center: boolean }[]).map(({ key, label, center }) => (
                    <th
                      key={key}
                      className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap hover:text-slate-200 ${center ? 'text-center' : ''}`}
                      onClick={() => toggleClubSort(key)}
                    >
                      {label}<SortIcon active={clubSort.key === key} dir={clubSort.dir} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedClubs.map((c, i) => {
                  const isSelected = c.club_type === selectedClubType
                  return (
                    <tr
                      key={`${c.club_type}-${i}`}
                      onClick={() => setSelectedClubType(isSelected ? null : c.club_type)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-green-900/40 ring-1 ring-green-700'
                          : i % 2 === 0
                          ? 'bg-slate-900 hover:bg-slate-800'
                          : 'bg-slate-950 hover:bg-slate-800'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{c.club}</div>
                        <div className="text-xs text-slate-500 uppercase">{c.club_type}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-center">{c.shot_count}</td>
                      <td className="px-4 py-3 text-center">
                        {c.carry_mean != null ? (
                          <span className="font-semibold text-green-300">{fmt(c.carry_mean)}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <StatCell value={c.carry_std} />
                      <StatCell value={adjusted ? (c.ball_speed_mean_adj ?? c.ball_speed_mean) : c.ball_speed_mean} unit=" mph" />
                      <StatCell value={adjusted ? (c.club_speed_mean_adj ?? c.club_speed_mean) : c.club_speed_mean} unit=" mph" />
                      <td className="px-4 py-3 text-center">
                        {c.smash_factor_mean != null ? (
                          <span
                            className={
                              c.smash_factor_mean >= 1.48
                                ? 'text-green-400'
                                : c.smash_factor_mean >= 1.44
                                ? 'text-yellow-400'
                                : 'text-red-400'
                            }
                          >
                            {c.smash_factor_mean.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <StatCell value={c.spin_rate_mean} decimals={0} />
                      <StatCell value={c.launch_angle_mean} unit="°" />
                      <StatCell value={c.side_carry_std} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Dispersion panel */}
          {selectedClubType && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">
                {clubs.find((c) => c.club_type === selectedClubType)?.club ?? selectedClubType} — Dispersion
              </h2>

              {loadingDispersion ? (
                <p className="text-slate-400 text-sm">Loading...</p>
              ) : (
                <>
                  {/* Comparison stat cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    <CompareCard
                      label={distanceMetric === 'total' ? 'Total Dist Avg' : 'Carry Avg'}
                      session={distanceMetric === 'total' ? sessionTotalMean : sessionCarryMean}
                      historical={distanceMetric === 'total' ? historicalTotalMean : historicalStats?.carry_mean}
                      unit=" yds"
                    />
                    <CompareCard
                      label={distanceMetric === 'total' ? 'Total Dist Std Dev' : 'Carry Std Dev'}
                      session={sessionDistStd}
                      historical={distanceMetric === 'total' ? stdDev(historicalClubShots.map((s) => s.total_distance).filter((v): v is number => v != null)) : historicalStats?.carry_std}
                      unit=" yds"
                      lowerIsBetter
                    />
                    <CompareCard
                      label="Side Dispersion (Std)"
                      session={sessionSideStd}
                      historical={historicalStats?.side_carry_std}
                      unit=" yds"
                      lowerIsBetter
                    />
                    <CompareCard
                      label="Smash Factor"
                      session={sessionClubStats?.smash_factor_mean}
                      historical={historicalStats?.smash_factor_mean}
                    />
                  </div>

                  {/* Scatter chart */}
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-white font-medium">
                          Shot Dispersion — {distanceMetric === 'total' ? 'Total Distance' : 'Carry'} vs Side
                        </h3>
                        <p className="text-slate-500 text-xs mt-0.5">
                          <span className="text-yellow-400">●</span> This session ({sessionPts.length} shots)
                          &nbsp;·&nbsp;
                          <span className="text-blue-400">●</span> Historical ({historicalPts.length} shots)
                          &nbsp;·&nbsp; 50% · 75% · 95% confidence ellipses
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex rounded overflow-hidden border border-slate-600 text-xs">
                          <button
                            onClick={() => setDistanceMetric('carry')}
                            className={`px-3 py-1 ${distanceMetric === 'carry' ? 'bg-green-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                          >
                            Carry
                          </button>
                          <button
                            onClick={() => setDistanceMetric('total')}
                            className={`px-3 py-1 ${distanceMetric === 'total' ? 'bg-green-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                          >
                            Total
                          </button>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          {sessionEllipses && <div>Session: {sessionEllipses.inlierCount} inliers</div>}
                          {historicalEllipses && <div>Historical: {historicalEllipses.inlierCount} inliers</div>}
                        </div>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={340}>
                      <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          name="Side Carry"
                          label={{
                            value: 'Side (yds)  ← left | right →',
                            position: 'bottom',
                            fill: '#94a3b8',
                            fontSize: 11,
                          }}
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          domain={['auto', 'auto']}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          name={distanceMetric === 'total' ? 'Total Distance' : 'Carry'}
                          label={{
                            value: distanceMetric === 'total' ? 'Total Distance (yds)' : 'Carry (yds)',
                            angle: -90,
                            position: 'insideLeft',
                            fill: '#94a3b8',
                            fontSize: 11,
                          }}
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{
                            background: '#1e293b',
                            border: '1px solid #475569',
                            borderRadius: 6,
                          }}
                          formatter={(v, name) => [
                            `${Number(v).toFixed(1)} yds`,
                            name === 'x' ? 'Side' : 'Carry',
                          ]}
                        />
                        <ReferenceLine x={0} stroke="#475569" />

                        {/* Historical dots */}
                        <Scatter
                          name="Historical"
                          data={historicalPts}
                          fill="#60a5fa"
                          fillOpacity={0.3}
                          isAnimationActive={false}
                        />
                        {/* Session dots */}
                        <Scatter
                          name="This session"
                          data={sessionPts}
                          fill="#facc15"
                          fillOpacity={0.85}
                          isAnimationActive={false}
                        />
                        {/* Historical ellipses — blue family */}
                        {historicalEllipses && (
                          <>
                            <Scatter
                              data={historicalEllipses.ellipses[2].points}
                              line={{ stroke: 'rgba(59,130,246,0.65)', strokeWidth: 1.5, strokeDasharray: '4 2' }}
                              shape={() => null as unknown as React.ReactElement}
                              fill="transparent"
                              isAnimationActive={false}
                              legendType="none"
                            />
                            <Scatter
                              data={historicalEllipses.ellipses[1].points}
                              line={{ stroke: 'rgba(59,130,246,0.82)', strokeWidth: 2.5, strokeDasharray: '6 2' }}
                              shape={() => null as unknown as React.ReactElement}
                              fill="transparent"
                              isAnimationActive={false}
                              legendType="none"
                            />
                            <Scatter
                              data={historicalEllipses.ellipses[0].points}
                              line={{ stroke: 'rgba(59,130,246,1.0)', strokeWidth: 3 }}
                              shape={() => null as unknown as React.ReactElement}
                              fill="transparent"
                              isAnimationActive={false}
                              legendType="none"
                            />
                          </>
                        )}
                        {/* Session ellipses — yellow family */}
                        {sessionEllipses && (
                          <>
                            <Scatter
                              data={sessionEllipses.ellipses[2].points}
                              line={{ stroke: 'rgba(234,179,8,0.65)', strokeWidth: 1.5, strokeDasharray: '4 2' }}
                              shape={() => null as unknown as React.ReactElement}
                              fill="transparent"
                              isAnimationActive={false}
                              legendType="none"
                            />
                            <Scatter
                              data={sessionEllipses.ellipses[1].points}
                              line={{ stroke: 'rgba(234,179,8,0.82)', strokeWidth: 2.5, strokeDasharray: '6 2' }}
                              shape={() => null as unknown as React.ReactElement}
                              fill="transparent"
                              isAnimationActive={false}
                              legendType="none"
                            />
                            <Scatter
                              data={sessionEllipses.ellipses[0].points}
                              line={{ stroke: 'rgba(234,179,8,1.0)', strokeWidth: 3 }}
                              shape={() => null as unknown as React.ReactElement}
                              fill="transparent"
                              isAnimationActive={false}
                              legendType="none"
                            />
                          </>
                        )}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}

            </div>
          )}

          {/* Shot log — always visible */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-white mb-3">Shot Log</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400 text-left">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Club</th>
                    {BASE_METRICS.map((m) => (
                      <th key={m.key} className="px-3 py-2 whitespace-nowrap">{adjusted ? m.adjLabel : m.label}</th>
                    ))}
                    <th className="px-3 py-2">Outlier</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sessionShots]
                    .sort((a, b) => a.shot_number - b.shot_number)
                    .map((shot, i) => (
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
                        <td className="px-3 py-1.5 font-medium whitespace-nowrap">{shot.club_type ?? '—'}</td>
                        {BASE_METRICS.map((m) => {
                          const rawVal = shot[m.key] as number | null
                          const adjVal = m.adjKey ? shot[m.adjKey] as number | null : null
                          const displayVal = adjusted && m.adjKey ? (adjVal ?? rawVal) : rawVal
                          return (
                            <td key={m.key} className="px-3 py-1.5 text-right">
                              {fmtShot(displayVal, m.unit)}
                            </td>
                          )
                        })}
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
        </>
      )}
      {adjusted && <AdjustedFootnote elevation={settings.elevation_ft} temperature={settings.temperature_f} />}
    </div>
  )
}
