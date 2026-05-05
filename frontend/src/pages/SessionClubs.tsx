import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import type { Session, ClubStats, Shot } from '../api'

// ── PCA / ellipse helpers ──────────────────────────────────────────────────

interface Point { x: number; y: number }

interface Ellipse {
  cx: number; cy: number
  rx: number; ry: number
  angleDeg: number
  inlierCount: number
}

function filterOutliersPearson(pts: Point[]): Point[] {
  if (pts.length < 4) return pts
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const p of pts) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  sxx /= n - 1; syy /= n - 1; sxy /= n - 1
  const det = sxx * syy - sxy * sxy
  if (det < 1e-10) return pts
  return pts.filter(p => {
    const dx = p.x - mx, dy = p.y - my
    const d2 = (syy * dx * dx - 2 * sxy * dx * dy + sxx * dy * dy) / det
    return d2 <= 4.605
  })
}

function computeEllipse(pts: Point[]): Ellipse | null {
  const inliers = filterOutliersPearson(pts)
  if (inliers.length < 3) return null
  const n = inliers.length
  const mx = inliers.reduce((s, p) => s + p.x, 0) / n
  const my = inliers.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const p of inliers) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  sxx /= n - 1; syy /= n - 1; sxy /= n - 1
  const trace = sxx + syy
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
  const lambda1 = trace / 2 + disc
  const lambda2 = trace / 2 - disc
  const angleDeg = (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI)
  const scale = Math.sqrt(3.219)
  return {
    cx: mx, cy: my,
    rx: Math.sqrt(Math.max(0, lambda1)) * scale,
    ry: Math.sqrt(Math.max(0, lambda2)) * scale,
    angleDeg,
    inlierCount: n,
  }
}

function ellipseOutlinePoints(e: Ellipse, n = 72): Point[] {
  const rad = (e.angleDeg * Math.PI) / 180
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI
    const ex = e.rx * Math.cos(t)
    const ey = e.ry * Math.sin(t)
    pts.push({
      x: e.cx + ex * Math.cos(rad) - ey * Math.sin(rad),
      y: e.cy + ex * Math.sin(rad) + ey * Math.cos(rad),
    })
  }
  return pts
}

// ── Metrics ────────────────────────────────────────────────────────────────

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
  const yVal = (s: Shot) => distanceMetric === 'total' ? s.total_distance : s.carry_distance

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

  const sessionEllipse = computeEllipse(sessionPts)
  const sessionEllipsePts = sessionEllipse ? ellipseOutlinePoints(sessionEllipse) : []
  const historicalEllipse = computeEllipse(historicalPts)
  const historicalEllipsePts = historicalEllipse ? ellipseOutlinePoints(historicalEllipse) : []

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
                    { key: 'ball_speed_mean', label: 'Ball Speed', center: true },
                    { key: 'club_speed_mean', label: 'Club Speed', center: true },
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
                      <StatCell value={c.ball_speed_mean} unit=" mph" />
                      <StatCell value={c.club_speed_mean} unit=" mph" />
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
                          &nbsp;·&nbsp; dashed = 80% ellipse
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
                          {sessionEllipse && <div>Session: {sessionEllipse.inlierCount} inliers</div>}
                          {historicalEllipse && <div>Historical: {historicalEllipse.inlierCount} inliers</div>}
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

                        {/* Historical ellipse */}
                        {historicalEllipsePts.length > 0 && (
                          <Scatter
                            data={historicalEllipsePts}
                            line={{ stroke: '#ffffff', strokeWidth: 1.5 }}
                            shape={() => null as unknown as React.ReactElement}
                            fill="transparent"
                            isAnimationActive={false}
                            legendType="none"
                          />
                        )}
                        {/* Session ellipse */}
                        {sessionEllipsePts.length > 0 && (
                          <Scatter
                            data={sessionEllipsePts}
                            line={{ stroke: '#ffffff', strokeWidth: 1.5 }}
                            shape={() => null as unknown as React.ReactElement}
                            fill="transparent"
                            isAnimationActive={false}
                            legendType="none"
                          />
                        )}
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
                    {METRICS.map((m) => (
                      <th key={m.key} className="px-3 py-2 whitespace-nowrap">{m.label}</th>
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
                        {METRICS.map((m) => (
                          <td key={m.key} className="px-3 py-1.5 text-right">
                            {fmtShot(shot[m.key] as number | null, m.unit)}
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
        </>
      )}
    </div>
  )
}
