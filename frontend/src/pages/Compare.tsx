import React, { useEffect, useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { api } from '../api'
import type { Shot, GtShot, Session } from '../api'

// ── Ellipse helpers (80% confidence, chi²(2,0.80) ≈ 3.219) ─────────────────

interface Point { x: number; y: number }
interface Ellipse { cx: number; cy: number; rx: number; ry: number; angleDeg: number; inlierCount: number }

function filterOutliersPearson(pts: Point[]): Point[] {
  if (pts.length < 4) return pts
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my) }
  sxx /= n - 1; syy /= n - 1; sxy /= n - 1
  const det = sxx * syy - sxy * sxy
  if (det < 1e-10) return pts
  // chi²(2, 0.90) ≈ 4.605
  return pts.filter(p => {
    const dx = p.x - mx, dy = p.y - my
    return (syy * dx * dx - 2 * sxy * dx * dy + sxx * dy * dy) / det <= 4.605
  })
}

function computeEllipse(pts: Point[]): Ellipse | null {
  const inliers = filterOutliersPearson(pts)
  if (inliers.length < 3) return null
  const n = inliers.length
  const mx = inliers.reduce((s, p) => s + p.x, 0) / n
  const my = inliers.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const p of inliers) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my) }
  sxx /= n - 1; syy /= n - 1; sxy /= n - 1
  const trace = sxx + syy
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
  const lambda1 = trace / 2 + disc
  const lambda2 = trace / 2 - disc
  const angleDeg = (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI)
  const scale = Math.sqrt(3.219)  // 80% chi² scale
  return { cx: mx, cy: my, rx: Math.sqrt(Math.max(0, lambda1)) * scale, ry: Math.sqrt(Math.max(0, lambda2)) * scale, angleDeg, inlierCount: n }
}

function ellipseArea(e: Ellipse): number {
  return Math.PI * e.rx * e.ry
}

function ellipseOutlinePoints(e: Ellipse, n = 72): Point[] {
  const rad = (e.angleDeg * Math.PI) / 180
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI
    const ex = e.rx * Math.cos(t)
    const ey = e.ry * Math.sin(t)
    pts.push({ x: e.cx + ex * Math.cos(rad) - ey * Math.sin(rad), y: e.cy + ex * Math.sin(rad) + ey * Math.cos(rad) })
  }
  return pts
}

// On-course club_id → Rapsodo club_type mapping
const CLUB_MAP: Record<number, string> = {
  1: 'd',
  16: '2h',
  5: '4i',
  6: '5i',
  8: '7i',
  9: '8i',
  10: '9i',
  11: 'pw',
  12: 'gw',
  13: 'sw',
}

// Rapsodo club_type → on-course club_id(s)
const REVERSE_MAP: Record<string, number[]> = {}
for (const [id, type] of Object.entries(CLUB_MAP)) {
  if (!REVERSE_MAP[type]) REVERSE_MAP[type] = []
  REVERSE_MAP[type].push(Number(id))
}

const CLUB_LABELS: Record<string, string> = {
  d: 'Driver', '2h': '2i Hybrid',
  '4i': '4 Iron', '5i': '5 Iron', '7i': '7 Iron',
  '8i': '8 Iron', '9i': '9 Iron',
  pw: 'Pitching Wedge', gw: 'Gap Wedge', sw: 'Sand Wedge',
}

const COMPARABLE_CLUBS = Object.keys(REVERSE_MAP)

interface DispPt {
  x: number
  y: number
  distance: number
  date: string | null
  meta: string | null
  outcome: string | null
  lie: string | null
  holeNumber: number | null
}

function toOnCoursePts(shots: GtShot[], avgDist: number): DispPt[] {
  return shots
    .filter((s) => s.distance_traveled != null && (s.dispersion_left != null || s.dispersion_right != null))
    .map((s) => ({
      x: (s.dispersion_right ?? 0) - (s.dispersion_left ?? 0),
      y: s.distance_traveled! - avgDist,
      distance: s.distance_traveled!,
      date: s.round_date,
      meta: s.course_name,
      outcome: s.outcome,
      lie: s.lie,
      holeNumber: s.hole_number,
    }))
}

function toRapsodoPts(shots: Shot[], avgTotal: number, sessionMap: Map<string, Session>): DispPt[] {
  return shots
    .filter((s) => s.side_carry != null && s.total_distance != null)
    .map((s) => {
      const session = sessionMap.get(s.session_id)
      return {
        x: s.side_carry!,
        y: s.total_distance! - avgTotal,
        distance: s.total_distance!,
        date: session?.session_date ?? null,
        meta: session?.session_type ?? null,
        outcome: null,
        lie: null,
        holeNumber: null,
      }
    })
}

function TooltipContent({ payload }: { payload?: { payload: DispPt }[] }) {
  if (!payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-slate-600 rounded p-2 text-xs space-y-0.5">
      {d.date && <div className="text-slate-400 font-medium">{d.date}</div>}
      {d.meta && <div className="text-slate-400">{d.meta}</div>}
      {d.holeNumber != null && <div className="text-slate-400">Hole {d.holeNumber}</div>}
      {d.lie && d.lie !== 'tee' && <div className="text-slate-500">Lie: {d.lie}</div>}
      {d.outcome && <div className="text-slate-500">Outcome: {d.outcome}</div>}
      <div className="text-slate-200 pt-0.5">{d.distance.toFixed(0)} yds</div>
      <div className="text-slate-200">
        {d.x >= 0 ? `${d.x.toFixed(0)} yds right` : `${(-d.x).toFixed(0)} yds left`}
      </div>
      <div className="text-slate-200">
        {d.y >= 0 ? `+${d.y.toFixed(0)} long` : `${(-d.y).toFixed(0)} short`}
      </div>
    </div>
  )
}

interface PanelSummary {
  avgCarry: number | null
  avgOffline: number | null
  area: number | null
  shotCount: number
}

interface LateralStats {
  bias: number          // signed mean of x: positive = right, negative = left
  sd: number            // std dev of x
  pctLeft: number       // % shots with x < 0
  pctRight: number      // % shots with x > 0
  width80: number       // 80% confidence lateral spread = 2 × sqrt(var(x)) × sqrt(3.219)
}

function computePanelSummary(pts: DispPt[]): PanelSummary {
  if (pts.length === 0) return { avgCarry: null, avgOffline: null, area: null, shotCount: 0 }
  const avgCarry = pts.reduce((s, p) => s + p.distance, 0) / pts.length
  const avgOffline = pts.reduce((s, p) => s + Math.abs(p.x), 0) / pts.length
  const ellipse = computeEllipse(pts.map(p => ({ x: p.x, y: p.y })))
  const area = ellipse ? ellipseArea(ellipse) : null
  return { avgCarry, avgOffline, area, shotCount: pts.length }
}

function computeLateralStats(pts: DispPt[]): LateralStats | null {
  if (pts.length < 2) return null
  const n = pts.length
  const mean = pts.reduce((s, p) => s + p.x, 0) / n
  const variance = pts.reduce((s, p) => s + (p.x - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)
  const pctLeft = (pts.filter(p => p.x < 0).length / n) * 100
  const pctRight = (pts.filter(p => p.x > 0).length / n) * 100
  const width80 = 2 * sd * Math.sqrt(3.219)
  return { bias: mean, sd, pctLeft, pctRight, width80 }
}

function SummaryRow({ summary }: { summary: PanelSummary }) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-3 border-t border-slate-700 pt-3">
      <div className="text-center">
        <div className="text-slate-500 text-xs">Avg Carry</div>
        <div className="text-slate-200 text-sm font-medium">
          {summary.avgCarry != null ? `${summary.avgCarry.toFixed(0)} yds` : '—'}
        </div>
      </div>
      <div className="text-center">
        <div className="text-slate-500 text-xs">Avg Offline</div>
        <div className="text-slate-200 text-sm font-medium">
          {summary.avgOffline != null ? `${summary.avgOffline.toFixed(1)} yds` : '—'}
        </div>
      </div>
      <div className="text-center">
        <div className="text-slate-500 text-xs">Ellipse Area</div>
        <div className="text-slate-200 text-sm font-medium">
          {summary.area != null ? `${summary.area.toFixed(0)} yd²` : '—'}
        </div>
      </div>
      <div className="text-center">
        <div className="text-slate-500 text-xs">Shots</div>
        <div className="text-slate-200 text-sm font-medium">
          {summary.shotCount > 0 ? summary.shotCount : '—'}
        </div>
      </div>
    </div>
  )
}

function LateralStatsRow({ stats }: { stats: LateralStats }) {
  const biasDir = stats.bias > 0.3 ? 'right' : stats.bias < -0.3 ? 'left' : 'center'
  const biasColor = biasDir === 'right' ? 'text-blue-400' : biasDir === 'left' ? 'text-amber-400' : 'text-slate-300'
  const biasLabel = biasDir === 'center'
    ? 'centered'
    : `${Math.abs(stats.bias).toFixed(1)} yds ${biasDir}`

  return (
    <div className="mt-3 border-t border-slate-700 pt-3">
      <div className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">Lateral Dispersion</div>
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="text-slate-500 text-xs">Bias</div>
          <div className={`text-sm font-medium ${biasColor}`}>{biasLabel}</div>
        </div>
        <div className="text-center">
          <div className="text-slate-500 text-xs">Lateral SD</div>
          <div className="text-slate-200 text-sm font-medium">{stats.sd.toFixed(1)} yds</div>
        </div>
        <div className="text-center">
          <div className="text-slate-500 text-xs">Left / Right</div>
          <div className="text-slate-200 text-sm font-medium tabular-nums">
            {stats.pctLeft.toFixed(0)}% / {stats.pctRight.toFixed(0)}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-slate-500 text-xs" title="Full lateral width containing 80% of shots">80% Width</div>
          <div className="text-slate-200 text-sm font-medium">{stats.width80.toFixed(1)} yds</div>
        </div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden relative">
        <div
          className="absolute inset-y-0 bg-slate-600 rounded-full"
          style={{
            left: `${Math.max(0, 50 - (stats.width80 / 2 / Math.max(stats.width80, 4)) * 50)}%`,
            width: `${Math.min(100, (stats.width80 / Math.max(stats.width80, 4)) * 50)}%`,
          }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-white rounded-full"
          style={{ left: `${Math.min(95, Math.max(5, 50 + (stats.bias / Math.max(stats.width80, 4)) * 50))}%` }}
        />
      </div>
      <div className="flex justify-between text-slate-600 text-xs mt-0.5 px-0.5">
        <span>Left</span><span>Center</span><span>Right</span>
      </div>
    </div>
  )
}

function ScatterPanel({
  title, subtitle, pts, color, axisMax,
}: {
  title: string
  subtitle: string
  pts: DispPt[]
  color: string
  axisMax: number
}) {
  const ellipse = pts.length >= 3 ? computeEllipse(pts.map(p => ({ x: p.x, y: p.y }))) : null
  const ellipsePts = ellipse ? ellipseOutlinePoints(ellipse) : []
  const summary = computePanelSummary(pts)
  const lateral = computeLateralStats(pts)

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 flex-1 min-w-0">
      <h3 className="text-white font-semibold text-sm mb-0.5">{title}</h3>
      <p className="text-slate-500 text-xs mb-3">{subtitle}</p>
      {pts.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-600 text-sm">No dispersion data</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                type="number" dataKey="x" name="Offline"
                domain={[-axisMax, axisMax]}
                tickCount={7}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                label={{ value: '← Left  |  Right →', position: 'bottom', fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis
                type="number" dataKey="y" name="Distance"
                domain={[-axisMax, axisMax]}
                tickCount={7}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                label={{ value: 'Short ↓ | Long ↑', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip content={<TooltipContent />} />
              <ReferenceLine x={0} stroke="#475569" />
              <ReferenceLine y={0} stroke="#475569" />
              <Scatter data={pts} fill={color} fillOpacity={0.7} r={5} />
              {ellipsePts.length > 0 && (
                <Scatter
                  data={ellipsePts}
                  line={{ stroke: '#ffffff', strokeWidth: 1.5 }}
                  shape={() => null as unknown as React.ReactElement}
                  fill="transparent"
                  legendType="none"
                  tooltipType="none"
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-slate-600 text-xs text-center mt-1">{pts.length} shots · 80% ellipse</p>
          <SummaryRow summary={summary} />
          {lateral && <LateralStatsRow stats={lateral} />}
        </>
      )}
    </div>
  )
}

interface ClubRankEntry {
  clubKey: string
  label: string
  area: number
}

export default function Compare() {
  const [selectedClub, setSelectedClub] = useState(COMPARABLE_CLUBS[0] ?? 'd')
  const [excludeMishits, setExcludeMishits] = useState(false)
  const [rapsodoShots, setRapsodoShots] = useState<Shot[]>([])
  const [onCourseShots, setOnCourseShots] = useState<GtShot[]>([])
  const [sessionMap, setSessionMap] = useState<Map<string, Session>>(new Map())
  const [allClubShots, setAllClubShots] = useState<Map<string, GtShot[]>>(new Map())

  useEffect(() => {
    api.sessions().then((sessions) => {
      setSessionMap(new Map(sessions.map((s) => [s.session_id, s])))
    }).catch(() => {})

    Promise.all(
      COMPARABLE_CLUBS.map((clubKey) => {
        const ids = REVERSE_MAP[clubKey] ?? []
        return Promise.all(ids.map((id) => api.gtShots(id)))
          .then((results) => [clubKey, results.flat()] as [string, GtShot[]])
      })
    ).then((entries) => {
      setAllClubShots(new Map(entries))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setRapsodoShots([])
    setOnCourseShots([])

    const clubIds = REVERSE_MAP[selectedClub] ?? []

    api.shotsByClub(selectedClub).then(setRapsodoShots).catch(() => {})

    Promise.all(clubIds.map((id) => api.gtShots(id)))
      .then((results) => setOnCourseShots(results.flat()))
      .catch(() => {})
  }, [selectedClub])

  const filteredRapsodo = excludeMishits ? rapsodoShots.filter((s) => !s.is_outlier) : rapsodoShots
  const filteredOnCourse = excludeMishits ? onCourseShots.filter((s) => !s.is_mishit) : onCourseShots

  const hiddenRapsodoCount = excludeMishits ? rapsodoShots.length - filteredRapsodo.length : 0
  const hiddenOnCourseCount = excludeMishits ? onCourseShots.length - filteredOnCourse.length : 0

  const totalDistShots = filteredRapsodo.filter((s) => s.total_distance != null)
  const avgTotal = totalDistShots.length
    ? totalDistShots.reduce((sum, s) => sum + s.total_distance!, 0) / totalDistShots.length
    : 0

  const distTraveledShots = filteredOnCourse.filter((s) => s.distance_traveled != null)
  const avgDist = distTraveledShots.length
    ? distTraveledShots.reduce((sum, s) => sum + s.distance_traveled!, 0) / distTraveledShots.length
    : 0

  const rapsodoPts = toRapsodoPts(filteredRapsodo, avgTotal, sessionMap)
  const onCoursePts = toOnCoursePts(filteredOnCourse, avgDist)

  const allVals = [
    ...rapsodoPts.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]),
    ...onCoursePts.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]),
  ]
  const axisMax = allVals.length ? Math.ceil(Math.max(...allVals) * 1.2 / 10) * 10 : 50

  const clubRanking: ClubRankEntry[] = useMemo(() => {
    const entries: ClubRankEntry[] = []
    for (const clubKey of COMPARABLE_CLUBS) {
      const shots = allClubShots.get(clubKey) ?? []
      const validShots = shots.filter((s) => s.distance_traveled != null && (s.dispersion_left != null || s.dispersion_right != null))
      if (validShots.length < 3) continue
      const avgD = validShots.reduce((s, sh) => s + sh.distance_traveled!, 0) / validShots.length
      const pts = toOnCoursePts(validShots, avgD)
      const ellipse = computeEllipse(pts.map((p) => ({ x: p.x, y: p.y })))
      if (!ellipse) continue
      entries.push({ clubKey, label: CLUB_LABELS[clubKey] ?? clubKey, area: ellipseArea(ellipse) })
    }
    return entries.sort((a, b) => a.area - b.area).slice(0, 3)
  }, [allClubShots])

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 flex-wrap">
        <h1 className="text-2xl font-bold text-white">Dispersion Comparison</h1>
        <select
          value={selectedClub}
          onChange={(e) => setSelectedClub(e.target.value)}
          className="bg-slate-800 text-white rounded px-3 py-1.5 text-sm border border-slate-600"
        >
          {COMPARABLE_CLUBS.map((c) => (
            <option key={c} value={c}>{CLUB_LABELS[c] ?? c} ({c})</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={excludeMishits}
            onChange={(e) => setExcludeMishits(e.target.checked)}
            className="accent-green-500 w-4 h-4"
          />
          Exclude mishits
        </label>
        {excludeMishits && (hiddenRapsodoCount > 0 || hiddenOnCourseCount > 0) && (
          <span className="text-slate-500 text-xs">
            Hiding{' '}
            {hiddenRapsodoCount > 0 && (
              <span>{hiddenRapsodoCount} of {rapsodoShots.length} Rapsodo</span>
            )}
            {hiddenRapsodoCount > 0 && hiddenOnCourseCount > 0 && <span>,  </span>}
            {hiddenOnCourseCount > 0 && (
              <span>{hiddenOnCourseCount} of {onCourseShots.length} on-course</span>
            )}
            {' '}shots
          </span>
        )}
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Both charts use the same scale. Y-axis = deviation from avg total distance. Recovery shots excluded.
      </p>

      {clubRanking.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 mb-5 inline-flex flex-col gap-1.5 min-w-52">
          <div className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">
            Most Consistent On-Course
          </div>
          {clubRanking.map((entry, i) => (
            <div key={entry.clubKey} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 text-xs w-4 text-right">{i + 1}.</span>
                <span className="text-slate-200 text-sm">{entry.label}</span>
              </div>
              <span className="text-slate-400 text-xs tabular-nums">{entry.area.toFixed(0)} yd²</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4 flex-col lg:flex-row">
        <ScatterPanel
          title="Launch Monitor (Rapsodo)"
          subtitle={`x = side carry · y = total vs avg (${avgTotal.toFixed(0)} yds)`}
          pts={rapsodoPts}
          color="#4ade80"
          axisMax={axisMax}
        />
        <ScatterPanel
          title="On-Course"
          subtitle={`x = offline (right/left) · y = distance vs avg (${avgDist.toFixed(0)} yds)`}
          pts={onCoursePts}
          color="#60a5fa"
          axisMax={axisMax}
        />
      </div>
    </div>
  )
}
