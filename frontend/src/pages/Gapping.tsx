import { useEffect, useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line,
} from 'recharts'
import { api } from '../api'
import type { ClubStats, MatrixRow, Shot } from '../api'
import { useBag } from '../BagContext'

function n(v: number | null | undefined, dec = 1) {
  return v == null ? '—' : v.toFixed(dec)
}

// Strip the speed-range suffix "(93+)" or "(82-93)" from effort labels for cross-club column headers
function effortRankLabel(label: string): string {
  return label.replace(/\s*\(\d[^)]*\)$/, '')
}

function linearRegression(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = pts.length
  if (n < 2) return null
  const sumX = pts.reduce((s, p) => s + p.x, 0)
  const sumY = pts.reduce((s, p) => s + p.y, 0)
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-10) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

const CLUB_LINE_COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399',
  '#22d3ee', '#60a5fa', '#818cf8', '#c084fc', '#f472b6',
  '#fdba74', '#86efac', '#67e8f9', '#93c5fd', '#a5b4fc',
  '#d8b4fe', '#fca5a5', '#d1d5db', '#4ade80',
]

// 8-color palette indexed by effort rank: rank 1 = full effort → blue; rank N = low effort → red
const BUCKET_PALETTE = ['#f87171', '#fb923c', '#facc15', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#818cf8']

function effortColor(rank: number, total: number): string {
  if (total <= 1) return BUCKET_PALETTE[6]
  // rank 1 = full effort → high-index (blue) end of palette
  const pos = Math.round(((total - rank) / Math.max(total - 1, 1)) * (BUCKET_PALETTE.length - 1))
  return BUCKET_PALETTE[Math.min(pos, BUCKET_PALETTE.length - 1)]
}

interface ClubRegLine {
  club_type: string
  color: string
  points: { x: number; y: number }[]
  n: number
}

interface GapRow extends ClubStats {
  gapUp: number | null
}

type SessionLimit = 'all' | '5' | '10' | '20'

const MIN_BUCKET_N = 3

// Dynamic chart datum — segment keys are seg_1, seg_2, ..., seg_N; carry keys are carry_1 etc.
interface ChartDatum {
  club_type: string
  carry_mean: number | null
  total_mean: number | null
  seg_all: number
  [key: string]: number | null | string
}

function aggregateByClubType(rows: ClubStats[]): ClubStats[] {
  const groups = new Map<string, ClubStats[]>()
  for (const r of rows) {
    const t = r.club_type ?? ''
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t)!.push(r)
  }
  return [...groups.values()].map((grp) => {
    if (grp.length === 1) return grp[0]
    const total = grp.reduce((s, r) => s + r.shot_count, 0)
    const wavg = (key: keyof ClubStats) => {
      const pairs = grp.filter((r) => r[key] != null).map((r) => [r[key] as number, r.shot_count] as const)
      if (!pairs.length) return null
      return pairs.reduce((s, [v, w]) => s + v * w, 0) / pairs.reduce((s, [, w]) => s + w, 0)
    }
    return {
      club: grp.map((r) => r.club).join(' / '),
      club_type: grp[0].club_type,
      shot_count: total,
      carry_mean: wavg('carry_mean'), carry_std: wavg('carry_std'),
      total_mean: wavg('total_mean'), total_std: wavg('total_std'),
      ball_speed_mean: wavg('ball_speed_mean'), spin_rate_mean: wavg('spin_rate_mean'),
      smash_factor_mean: wavg('smash_factor_mean'), side_carry_mean: wavg('side_carry_mean'),
      side_carry_std: wavg('side_carry_std'), launch_angle_mean: wavg('launch_angle_mean'),
      club_speed_mean: wavg('club_speed_mean'),
    }
  })
}

function GapTooltip({ active, payload, label, allBuckets, totalBuckets }: {
  active?: boolean
  payload?: { payload: ChartDatum }[]
  label?: string
  allBuckets: string[]
  totalBuckets: number
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6, padding: '8px 12px', minWidth: 190 }}>
      <p style={{ color: '#fff', fontWeight: 600, marginBottom: 6 }}>{label}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '2px 10px', alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontSize: 11 }}></span>
        <span style={{ color: '#64748b', fontSize: 11, textAlign: 'right' }}>Carry</span>
        <span style={{ color: '#64748b', fontSize: 11, textAlign: 'right' }}>Total</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>Avg</span>
        <span style={{ color: '#4ade80', textAlign: 'right' }}>{n(d.carry_mean)} yds</span>
        <span style={{ color: '#4ade80', textAlign: 'right' }}>{n(d.total_mean)} yds</span>
        {allBuckets.map((b) => {
          const carry = d[`carry_${b}`] as number | null
          const total = d[`total_${b}`] as number | null
          if (carry == null) return null
          const label = d[`label_${b}`] as string | null
          const color = effortColor(parseInt(b), totalBuckets)
          return (
            <>
              <span key={b} style={{ color, fontSize: 12 }}>{label ?? `Bucket ${b}`}</span>
              <span style={{ color, textAlign: 'right' }}>{n(carry)} yds</span>
              <span style={{ color, textAlign: 'right' }}>{n(total)} yds</span>
            </>
          )
        })}
      </div>
    </div>
  )
}

interface SimResult {
  club_type: string
  effort: string
  carry: number
  total: number
  carryDiff: number
  totalDiff: number
  score: number
  shot_count: number
}

const RANK_BADGES: { label: string; bg: string; text: string }[] = [
  { label: '1st', bg: 'bg-yellow-500', text: 'text-slate-950' },
  { label: '2nd', bg: 'bg-slate-400', text: 'text-slate-950' },
  { label: '3rd', bg: 'bg-amber-700', text: 'text-white' },
]

function ShotSimulator({ stats, matrix, allBuckets, totalBuckets }: {
  stats: ClubStats[]
  matrix: MatrixRow[]
  allBuckets: string[]
  totalBuckets: number
}) {
  const [carryInput, setCarryInput] = useState('')
  const [totalInput, setTotalInput] = useState('')

  const results = useMemo<SimResult[]>(() => {
    const carry = parseFloat(carryInput)
    const total = parseFloat(totalInput)
    const hasCarry = !isNaN(carry)
    const hasTotal = !isNaN(total)
    if (!hasCarry && !hasTotal) return []

    const matrixByClub = Object.fromEntries(matrix.map((r) => [r.club_type, r.buckets]))
    const rows: SimResult[] = []

    for (const c of stats) {
      if (!c.club_type) continue
      const buckets = matrixByClub[c.club_type] ?? {}

      const options: { effort: string; carry: number | null; total: number | null }[] = [
        { effort: 'Avg', carry: c.carry_mean, total: c.total_mean },
      ]
      for (const b of allBuckets) {
        const bkt = (buckets[b]?.n ?? 0) >= MIN_BUCKET_N ? buckets[b] : null
        if (bkt) {
          const label = bkt.label ?? `Bucket ${b}`
          options.push({ effort: label, carry: bkt.carry_mean, total: bkt.total_mean })
        }
      }

      for (const opt of options) {
        if (opt.carry == null && opt.total == null) continue
        const carryDiff = hasCarry && opt.carry != null ? opt.carry - carry : 0
        const totalDiff = hasTotal && opt.total != null ? opt.total - total : 0
        const carryErr  = hasCarry && opt.carry != null ? Math.abs(carryDiff) : 0
        const totalErr  = hasTotal && opt.total != null ? Math.abs(totalDiff) : 0
        const score = (hasCarry && hasTotal) ? (carryErr + totalErr) / 2
                    : hasCarry ? carryErr
                    : totalErr
        rows.push({
          club_type: c.club_type,
          effort: opt.effort,
          carry: opt.carry ?? 0,
          total: opt.total ?? 0,
          carryDiff,
          totalDiff,
          score,
          shot_count: c.shot_count,
        })
      }
    }

    // Deduplicate to the best result per club_type, then return top 3
    const bestPerClub = new Map<string, SimResult>()
    for (const r of rows.sort((a, b) => a.score - b.score)) {
      if (!bestPerClub.has(r.club_type)) bestPerClub.set(r.club_type, r)
    }
    return [...bestPerClub.values()].slice(0, 3)
  }, [carryInput, totalInput, stats, matrix, allBuckets])

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
      <h2 className="text-white font-semibold mb-1">Shot Simulator</h2>
      <p className="text-slate-400 text-xs mb-4">Enter a target distance to find the best club and effort options.</p>
      <div className="flex flex-wrap gap-4 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400 text-xs">Target Carry (yds)</span>
          <input
            type="number"
            value={carryInput}
            onChange={(e) => setCarryInput(e.target.value)}
            placeholder="e.g. 150"
            className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 w-36 text-sm focus:outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400 text-xs">Target Total (yds)</span>
          <input
            type="number"
            value={totalInput}
            onChange={(e) => setTotalInput(e.target.value)}
            placeholder="e.g. 165"
            className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 w-36 text-sm focus:outline-none focus:border-blue-500"
          />
        </label>
        {(carryInput || totalInput) && (
          <button
            onClick={() => { setCarryInput(''); setTotalInput('') }}
            className="self-end text-slate-500 hover:text-slate-300 text-xs pb-2"
          >
            Clear
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          {results.map((r, i) => {
            const badge = RANK_BADGES[i]
            const carryDeltaColor = r.carryDiff > 0 ? 'text-yellow-400' : r.carryDiff < 0 ? 'text-red-400' : 'text-slate-400'
            const totalDeltaColor = r.totalDiff > 0 ? 'text-yellow-400' : r.totalDiff < 0 ? 'text-red-400' : 'text-slate-400'
            return (
              <div key={r.club_type} className="flex items-center gap-3 bg-slate-800 rounded-lg px-4 py-3 border border-slate-700">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold shrink-0 ${badge.bg} ${badge.text}`}>
                  {badge.label}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-white font-semibold text-base">{r.club_type}</span>
                    <span className="text-slate-400 text-xs">{r.effort}</span>
                    <span className="text-slate-500 text-xs">{r.shot_count} shots</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-sm">
                    <span className="text-slate-200">{n(r.carry)} yds carry</span>
                    <span className="text-slate-400">{n(r.total)} yds total</span>
                    {carryInput && (
                      <span className={`font-medium ${carryDeltaColor}`}>
                        carry {r.carryDiff >= 0 ? '+' : ''}{n(r.carryDiff)}
                      </span>
                    )}
                    {totalInput && (
                      <span className={`font-medium ${totalDeltaColor}`}>
                        total {r.totalDiff >= 0 ? '+' : ''}{n(r.totalDiff)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(carryInput || totalInput) && results.length === 0 && (
        <p className="text-slate-500 text-sm">No matching club data found.</p>
      )}
    </div>
  )
}

export default function Gapping() {
  const [allStats, setAllStats] = useState<ClubStats[]>([])
  const [allMatrix, setAllMatrix] = useState<MatrixRow[]>([])
  const [allShots, setAllShots] = useState<Record<string, Shot[]>>({})
  const [hoveredClub, setHoveredClub] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionLimit, setSessionLimit] = useState<SessionLimit>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const { disabledClubs, isActive } = useBag()

  useEffect(() => {
    const disabledParam = disabledClubs.size > 0 ? [...disabledClubs].join(',') : undefined
    const statsParams: Record<string, string> = {}
    if (disabledParam) statsParams.disabled_clubs = disabledParam
    if (sessionLimit !== 'all') statsParams.limit_sessions = String(sessionLimit)
    if (dateFrom) statsParams.date_from = dateFrom
    if (dateTo) statsParams.date_to = dateTo
    const matrixParams: Record<string, string> = { all_clubs: 'true' }
    if (disabledParam) matrixParams.disabled_clubs = disabledParam
    if (sessionLimit !== 'all') matrixParams.limit_sessions = String(sessionLimit)
    if (dateFrom) matrixParams.date_from = dateFrom
    if (dateTo) matrixParams.date_to = dateTo
    Promise.all([
      api.clubStats(Object.keys(statsParams).length ? statsParams : undefined),
      api.wedgeMatrix(matrixParams),
    ])
      .then(([s, m]) => { setAllStats(s); setAllMatrix(m) })
      .catch(() => setError('Failed to load club stats — is the API running?'))
  }, [disabledClubs, sessionLimit, dateFrom, dateTo])

  useEffect(() => {
    const clubTypes = [...new Set(allStats.map((c) => c.club_type).filter(Boolean))] as string[]
    if (clubTypes.length === 0) return
    const disabledParam = disabledClubs.size > 0 ? [...disabledClubs].join(',') : undefined
    const extraParams: Record<string, string> = {}
    if (disabledParam) extraParams.disabled_clubs = disabledParam
    if (sessionLimit !== 'all') extraParams.limit_sessions = String(sessionLimit)
    if (dateFrom) extraParams.date_from = dateFrom
    if (dateTo) extraParams.date_to = dateTo
    Promise.all(
      clubTypes.map((ct) => api.shotsByClub(ct, Object.keys(extraParams).length ? extraParams : undefined).then((shots) => [ct, shots] as const))
    ).then((entries) => setAllShots(Object.fromEntries(entries)))
  }, [allStats, disabledClubs, sessionLimit, dateFrom, dateTo])

  const stats = aggregateByClubType(allStats.filter((c) => isActive(c.club_type ?? '', c.club)))
  const matrix = allMatrix
  const matrixByClub = Object.fromEntries(matrix.map((r) => [r.club_type, r.buckets]))

  // All bucket indices present in matrix data, sorted numerically
  const allBuckets = useMemo(() => {
    const keys = new Set<string>()
    matrix.forEach((r) => Object.keys(r.buckets).filter((k) => k !== 'unknown').forEach((k) => keys.add(k)))
    return [...keys].sort((a, b) => parseInt(a) - parseInt(b))
  }, [matrix])
  const totalBuckets = allBuckets.length

  // For sorting/gapping: use full-effort (rank 1 = first in ascending sort) carry as the reference
  const getRefCarry = (c: ClubStats) => {
    const buckets = matrixByClub[c.club_type ?? ''] ?? {}
    const topKey = allBuckets[0] // rank 1 = full effort
    const b = topKey ? buckets[topKey] : null
    return (b?.n ?? 0) >= MIN_BUCKET_N ? (b?.carry_mean ?? c.carry_mean) : c.carry_mean
  }

  const ascending = [...stats]
    .filter((c) => c.carry_mean != null && c.club_type != null)
    .sort((a, b) => (getRefCarry(a) ?? 0) - (getRefCarry(b) ?? 0))

  const descending: GapRow[] = ascending
    .slice()
    .reverse()
    .map((c, i, arr) => ({
      ...c,
      gapUp: i > 0 ? (getRefCarry(arr[i - 1]) ?? 0) - (getRefCarry(c) ?? 0) : null,
    }))

  const chartData: ChartDatum[] = ascending.map((c) => {
    const buckets = matrixByClub[c.club_type ?? ''] ?? {}
    const validBuckets = Object.fromEntries(
      allBuckets.map((k) => [k, (buckets[k]?.n ?? 0) >= MIN_BUCKET_N ? buckets[k] : null])
    )
    const hasEffort = allBuckets.some((k) => validBuckets[k] != null)

    const datum: ChartDatum = {
      club_type: c.club_type ?? '',
      carry_mean: c.carry_mean,
      total_mean: c.total_mean,
      seg_all: hasEffort ? 0 : (c.carry_mean ?? 0),
    }

    for (const k of allBuckets) {
      datum[`carry_${k}`] = validBuckets[k]?.carry_mean ?? null
      datum[`total_${k}`] = validBuckets[k]?.total_mean ?? null
      datum[`label_${k}`] = validBuckets[k]?.label ?? null
    }

    if (hasEffort) {
      // Stack from lowest effort (highest rank index) as base up to full effort (rank 1).
      // stackOrder = allBuckets reversed: [N, N-1, ..., 2, 1] = low→high effort order
      const stackOrder = allBuckets.slice().reverse()

      // Find the lowest-effort carry as the base
      let baseCarry = 0
      for (const k of stackOrder) {
        const cv = validBuckets[k]?.carry_mean
        if (cv != null) { baseCarry = cv; break }
      }

      // Forward-fill carries in stack order (low→high effort = ascending carry)
      const filled: number[] = new Array(stackOrder.length)
      filled[0] = validBuckets[stackOrder[0]]?.carry_mean ?? baseCarry
      for (let i = 1; i < stackOrder.length; i++) {
        filled[i] = validBuckets[stackOrder[i]]?.carry_mean ?? filled[i - 1]
      }

      datum[`seg_${stackOrder[0]}`] = filled[0]
      for (let i = 1; i < stackOrder.length; i++) {
        datum[`seg_${stackOrder[i]}`] = Math.max(0, filled[i] - filled[i - 1])
      }
    } else {
      for (const k of allBuckets) datum[`seg_${k}`] = 0
    }

    return datum
  })

  const hasEffortData = chartData.some((d) =>
    allBuckets.some((k) => (d[`carry_${k}`] as number | null) != null)
  )

  const clubRegressions = useMemo<ClubRegLine[]>(() => {
    return ascending.flatMap((c, i) => {
      const ct = c.club_type ?? ''
      const shots = allShots[ct] ?? []
      const pts = shots
        .filter((s) => s.club_speed != null && s.carry_distance != null && !s.is_outlier)
        .map((s) => ({ x: s.club_speed!, y: s.carry_distance! }))
      if (pts.length < 3) return []
      const reg = linearRegression(pts)
      if (!reg) return []
      const xs = pts.map((p) => p.x)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      return [{
        club_type: ct,
        color: CLUB_LINE_COLORS[i % CLUB_LINE_COLORS.length],
        points: [
          { x: minX, y: reg.slope * minX + reg.intercept },
          { x: maxX, y: reg.slope * maxX + reg.intercept },
        ],
        n: pts.length,
      }]
    })
  }, [ascending, allShots])

  const speedDomain = useMemo(() => {
    if (clubRegressions.length === 0) return ['auto', 'auto'] as const
    const allX = clubRegressions.flatMap((cr) => cr.points.map((p) => p.x))
    const pad = (Math.max(...allX) - Math.min(...allX)) * 0.04
    return [Math.floor(Math.min(...allX) - pad), Math.ceil(Math.max(...allX) + pad)] as [number, number]
  }, [clubRegressions])

  const carryDomain = useMemo(() => {
    if (clubRegressions.length === 0) return ['auto', 'auto'] as const
    const allY = clubRegressions.flatMap((cr) => cr.points.map((p) => p.y))
    const pad = (Math.max(...allY) - Math.min(...allY)) * 0.06
    return [Math.floor(Math.min(...allY) - pad), Math.ceil(Math.max(...allY) + pad)] as [number, number]
  }, [clubRegressions])

  if (error) return <div className="text-red-400 text-sm mt-8 text-center">{error}</div>

  if (stats.length === 0) return (
    <div className="text-center py-20 text-slate-500">
      <p className="text-lg mb-2">No club data yet</p>
      <p className="text-sm">Upload Rapsodo session data on the Sessions tab first.</p>
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Club Gapping</h1>
      <p className="text-slate-400 text-sm mb-4">
        Average carry and total distance per club. Gaps are to the next longer club.
        {hasEffortData && ' Bar segments show carry distance by swing effort (low → high).'}
      </p>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <label htmlFor="session-limit" className="text-slate-400 text-sm shrink-0">Sessions:</label>
          <select
            id="session-limit"
            value={sessionLimit}
            onChange={(e) => setSessionLimit(e.target.value as SessionLimit)}
            className="bg-slate-800 border border-slate-600 text-slate-100 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">All sessions</option>
            <option value="5">Last 5</option>
            <option value="10">Last 10</option>
            <option value="20">Last 20</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-sm shrink-0">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-slate-100 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-sm shrink-0">To:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-slate-100 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo('') }}
            className="text-slate-500 hover:text-slate-300 text-xs"
          >
            Clear dates
          </button>
        )}
      </div>

      <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
        <h2 className="text-white font-semibold mb-3">Carry Distance by Club</h2>
        {hasEffortData && (
          <div className="flex flex-wrap gap-3 mb-3 text-xs text-slate-400">
            {allBuckets.slice().reverse().map((b) => {
              const color = effortColor(parseInt(b), totalBuckets)
              const rawLabel = matrix.find((r) => r.buckets[b]?.label)?.buckets[b]?.label ?? `Bucket ${b}`
              return (
                <span key={b}><span className="inline-block w-3 h-3 rounded-sm mr-1" style={{ background: color }} />{effortRankLabel(rawLabel)}</span>
              )
            })}
          </div>
        )}
        <ResponsiveContainer width="100%" height={Math.max(280, ascending.length * 38)}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 60, bottom: 24, left: 56 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
            <XAxis
              type="number"
              domain={['auto', 'auto']}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: 'Avg Carry (yds)', position: 'insideBottomRight', offset: -4, fill: '#94a3b8', fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="club_type"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              width={48}
            />
            <Tooltip content={<GapTooltip allBuckets={allBuckets} totalBuckets={totalBuckets} />} />
            <Bar dataKey="seg_all" stackId="a" fill="#4ade80" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            {allBuckets.slice().reverse().map((b, i, arr) => (
              <Bar
                key={b}
                dataKey={`seg_${b}`}
                stackId="a"
                fill={effortColor(parseInt(b), totalBuckets)}
                isAnimationActive={false}
                radius={i === arr.length - 1 ? [0, 3, 3, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {clubRegressions.length >= 2 && (
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
          <h2 className="text-white font-semibold mb-1">Carry vs Club Speed — Best Fit Lines</h2>
          <p className="text-slate-500 text-xs mb-4">One regression line per club · hover a line to identify it</p>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart margin={{ top: 8, right: 20, bottom: 24, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                type="number"
                dataKey="x"
                domain={speedDomain}
                label={{ value: 'Club Speed (mph)', position: 'insideBottomRight', offset: -4, fill: '#94a3b8', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={carryDomain}
                label={{ value: 'Carry (yds)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0]
                  const cr = clubRegressions.find((r) => r.club_type === item.name)
                  if (!cr) return null
                  const pt = item.payload as { x: number; y: number }
                  return (
                    <div style={{ background: '#1e293b', border: `1px solid ${cr.color}`, borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                      <div style={{ color: cr.color, fontWeight: 600, marginBottom: 2 }}>{cr.club_type}</div>
                      <div style={{ color: '#94a3b8' }}>{pt.x.toFixed(1)} mph → <span style={{ color: '#fff' }}>{pt.y.toFixed(1)} yds</span></div>
                    </div>
                  )
                }}
              />
              {clubRegressions.map((cr) => (
                <Line
                  key={cr.club_type}
                  data={cr.points}
                  dataKey="y"
                  name={cr.club_type}
                  stroke={cr.color}
                  strokeWidth={hoveredClub === cr.club_type ? 4 : 1.5}
                  strokeOpacity={hoveredClub != null && hoveredClub !== cr.club_type ? 0.2 : 1}
                  dot={false}
                  activeDot={{ r: 5, fill: cr.color, strokeWidth: 0 }}
                  isAnimationActive={false}
                  onMouseEnter={() => setHoveredClub(cr.club_type)}
                  onMouseLeave={() => setHoveredClub(null)}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {clubRegressions.map((cr) => (
              <span
                key={cr.club_type}
                className="flex items-center gap-1 text-xs cursor-default"
                style={{ opacity: hoveredClub != null && hoveredClub !== cr.club_type ? 0.35 : 1 }}
                onMouseEnter={() => setHoveredClub(cr.club_type)}
                onMouseLeave={() => setHoveredClub(null)}
              >
                <span className="inline-block w-5 h-0.5 rounded" style={{ background: cr.color }} />
                <span style={{ color: cr.color }}>{cr.club_type}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <ShotSimulator stats={stats} matrix={matrix} allBuckets={allBuckets} totalBuckets={totalBuckets} />

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3">Club</th>
              <th className="px-4 py-3 text-right">Avg Carry</th>
              <th className="px-4 py-3 text-right">Carry Range</th>
              <th className="px-4 py-3 text-right">Avg Total</th>
              <th className="px-4 py-3 text-right">±Std Dev</th>
              <th className="px-4 py-3 text-right">Side Disp.</th>
              {hasEffortData && allBuckets.map((b) => {
                const color = effortColor(parseInt(b), totalBuckets)
                const rawLabel = matrix.find((r) => r.buckets[b]?.label)?.buckets[b]?.label ?? `Bucket ${b}`
                return (
                  <th key={b} className="px-4 py-3 text-right" style={{ color }}>
                    {effortRankLabel(rawLabel)}
                  </th>
                )
              })}
              <th className="px-4 py-3 text-right">Gap to Next ↑</th>
              <th className="px-4 py-3 text-right">Shots</th>
            </tr>
          </thead>
          <tbody>
            {descending.map((c, i) => {
              const buckets = matrixByClub[c.club_type ?? ''] ?? {}
              const gapBadge = c.gapUp == null
                ? null
                : c.gapUp <= 0
                  ? { cls: 'bg-red-600 text-white', label: `${Math.abs(Math.round(c.gapUp))} yd overlap` }
                  : c.gapUp <= 5
                    ? { cls: 'bg-amber-500 text-slate-950', label: `+${Math.round(c.gapUp)} yd gap` }
                    : { cls: 'bg-green-600 text-white', label: `+${Math.round(c.gapUp)} yd gap` }
              return (
                <tr
                  key={c.club_type}
                  className={i % 2 === 0 ? 'bg-slate-900 text-slate-200' : 'bg-slate-950 text-slate-200'}
                >
                  <td className="px-4 py-2.5 font-medium text-white">{c.club_type}</td>
                  <td className="px-4 py-2.5 text-right">{n(c.carry_mean)} yds</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">
                    {c.carry_mean != null && c.carry_std != null
                      ? `${n(c.carry_mean, 0)} ± ${n(c.carry_std, 0)} yds`
                      : c.carry_mean != null ? `${n(c.carry_mean, 0)} yds` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{n(c.total_mean)} yds</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">±{n(c.carry_std)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">±{n(c.side_carry_std)} yds</td>
                  {hasEffortData && allBuckets.map((b) => {
                    const bkt = (buckets[b]?.n ?? 0) >= MIN_BUCKET_N ? buckets[b] : null
                    const color = effortColor(parseInt(b), totalBuckets)
                    return (
                      <td key={b} className="px-4 py-2.5 text-right" style={{ color }}>
                        {bkt ? (
                          <div className="leading-tight">
                            <div>{n(bkt.carry_mean)} / {n(bkt.total_mean)} yds</div>
                            <div className="text-xs opacity-60">±{n(bkt.carry_std)} dist</div>
                            <div className="text-xs opacity-60">±{n(bkt.side_carry_std)} side</div>
                            <div className="text-xs opacity-60">{n(bkt.apex_mean)} apex</div>
                            <div className="text-xs opacity-60">{n(bkt.speed_mean)} mph</div>
                            <div className="text-xs opacity-60">{n(bkt.spin_rate_mean, 0)} rpm</div>
                            <div className="text-xs opacity-60">{n(bkt.smash_factor_mean, 2)} smash</div>
                            <div className="text-xs opacity-60">{n(bkt.attack_angle_mean, 1)}° AoA</div>
                            <span className="text-slate-500 text-xs">({bkt.n})</span>
                          </div>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right">
                    {gapBadge
                      ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${gapBadge.cls}`}>{gapBadge.label}</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{c.shot_count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-slate-900 border-t border-slate-700 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-2">
            Gap:
            <span className="inline-block px-2 py-0.5 rounded bg-green-600 text-white font-semibold">&gt;5 yd gap</span>
            <span className="inline-block px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-semibold">1–5 yd gap</span>
            <span className="inline-block px-2 py-0.5 rounded bg-red-600 text-white font-semibold">overlap</span>
          </span>
          {hasEffortData && (
            <span>Effort: {allBuckets.slice().reverse().map((b) => {
              const color = effortColor(parseInt(b), totalBuckets)
              const rawLabel = matrix.find((r) => r.buckets[b]?.label)?.buckets[b]?.label ?? `Bucket ${b}`
              return (
                <span key={b}><span style={{ color }}>●</span> {effortRankLabel(rawLabel)} &nbsp;</span>
              )
            })}</span>
          )}
        </div>
      </div>
    </div>
  )
}
