import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { api } from '../api'
import type { MatrixRow } from '../api'
import { useBag } from '../BagContext'

const BUCKET_PALETTE = ['#f87171', '#fb923c', '#facc15', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#818cf8']

function effortRankLabel(label: string): string {
  return label.replace(/\s*\(\d[^)]*\)$/, '')
}

// rank 1 = full effort → blue end; rank N = low effort → red end
function effortColor(rank: number, total: number): string {
  if (total <= 1) return BUCKET_PALETTE[6]
  const pos = Math.round(((total - rank) / Math.max(total - 1, 1)) * (BUCKET_PALETTE.length - 1))
  return BUCKET_PALETTE[Math.min(pos, BUCKET_PALETTE.length - 1)]
}

const MIN_SHOTS = 5

function n(v: number | null | undefined, dec = 1) {
  return v == null ? '—' : v.toFixed(dec)
}

function carryColor(value: number | null, min: number, max: number): string {
  if (value == null || max === min) return ''
  const t = (value - min) / (max - min)
  const alpha = Math.round(30 + t * 180)
  return `rgba(74, 222, 128, ${alpha / 255})`
}

// Blend green cell over slate-900 background and pick white or dark text for readability
function carryTextColor(value: number | null, min: number, max: number): string {
  if (value == null || max === min) return 'white'
  const t = (value - min) / (max - min)
  const alpha = (30 + t * 180) / 255
  const r = 74 * alpha + 15 * (1 - alpha)
  const g = 222 * alpha + 23 * (1 - alpha)
  const b = 128 * alpha + 42 * (1 - alpha)
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  return luma > 128 ? '#0f172a' : 'white'
}

export default function WedgeMatrix() {
  const [rows, setRows] = useState<MatrixRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [findYardage, setFindYardage] = useState<number | null>(null)
  const { disabledClubs } = useBag()

  useEffect(() => {
    const params: Record<string, string> = {}
    if (showAll) params.all_clubs = 'true'
    if (disabledClubs.size > 0) params.disabled_clubs = [...disabledClubs].join(',')
    api.wedgeMatrix(Object.keys(params).length ? params : undefined)
      .then(setRows)
      .catch(() => setError('Failed to load matrix — run calibration first'))
  }, [showAll, disabledClubs])

  // Derive all rank keys present in data, sorted numerically (rank 1 = full effort → rank N = low effort)
  const allBuckets = useMemo(() => {
    const keys = new Set<string>()
    rows.forEach((r) => Object.keys(r.buckets).filter((k) => k !== 'unknown').forEach((k) => keys.add(k)))
    return [...keys].sort((a, b) => parseInt(a) - parseInt(b))
  }, [rows])

  const totalBuckets = allBuckets.length

  // Only show buckets that have at least one club with enough shots
  const activeBuckets = allBuckets.filter((b) =>
    rows.some((r) => (r.buckets[b]?.n ?? 0) >= MIN_SHOTS)
  )

  // For each club row, the bucket key closest to findYardage (one per row).
  const highlightedCells = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>()
    if (findYardage === null) return map
    rows.forEach((row) => {
      let bestKey: string | null = null
      let bestDist = Infinity
      activeBuckets.forEach((b) => {
        const carry = row.buckets[b]?.carry_mean
        if (carry == null) return
        const dist = Math.abs(carry - findYardage)
        if (dist < bestDist) {
          bestDist = dist
          bestKey = b
        }
      })
      if (bestKey !== null) map.set(row.club_type, bestKey)
    })
    return map
  }, [findYardage, rows, activeBuckets])

  const allCarry = rows.flatMap((r) =>
    activeBuckets.map((b) => r.buckets[b]?.carry_mean ?? null).filter((v): v is number => v != null)
  )
  const minCarry = allCarry.length ? Math.min(...allCarry) : 0
  const maxCarry = allCarry.length ? Math.max(...allCarry) : 0

  if (error) return <div className="text-red-400 text-sm mt-8 text-center">{error}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">Wedge Matrix</h1>
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="accent-green-500"
          />
          All clubs
        </label>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Avg carry distance by club × swing effort. Cells with fewer than {MIN_SHOTS} shots are hidden.
        Color intensity = carry distance. Buckets ordered full effort → low effort.
      </p>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-slate-400" htmlFor="find-yardage">Find yardage:</label>
        <input
          id="find-yardage"
          type="number"
          min={0}
          className="w-24 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="e.g. 80"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const val = e.target.value
            setFindYardage(val === '' ? null : Number(val))
          }}
        />
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="mb-2">No data yet.</p>
          <p className="text-sm">Run calibration on the Swing Effort page first.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-left">
              <tr>
                <th className="px-4 py-3 text-white">Club</th>
                {activeBuckets.map((b) => {
                  const color = effortColor(parseInt(b), totalBuckets)
                  const label = rows.find((r) => r.buckets[b]?.label)?.buckets[b]?.label ?? `Bucket ${b}`
                  return (
                    <th key={b} className="px-4 py-3 text-center font-semibold" style={{ color }} colSpan={2}>
                      {effortRankLabel(label)}
                    </th>
                  )
                })}
              </tr>
              <tr className="text-xs border-t border-slate-700">
                <th className="px-4 py-2" />
                {activeBuckets.map((b) => (
                  <>
                    <th key={`${b}-carry`} className="px-3 py-2 text-center text-slate-400">Carry</th>
                    <th key={`${b}-speed`} className="px-3 py-2 text-center text-slate-500">Spd / n</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.club_type}
                  className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'}
                >
                  <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                    <div>{row.club_type}</div>
                    <div className="text-xs text-slate-500 font-normal">{row.club}</div>
                  </td>
                  {activeBuckets.map((b) => {
                    const bucket = row.buckets[b]
                    const valid = bucket && bucket.n >= MIN_SHOTS
                    const bg = valid ? carryColor(bucket.carry_mean, minCarry, maxCarry) : ''
                    const textColor = bg ? carryTextColor(bucket.carry_mean, minCarry, maxCarry) : undefined
                    const subTextColor = textColor ? { color: textColor, opacity: 0.65 } : undefined
                    const highlighted = highlightedCells.get(row.club_type) === b
                    return (
                      <>
                        <td
                          key={`${row.club_type}-${b}-carry`}
                          className={`px-3 py-3 text-center font-medium${highlighted ? ' ring-2 ring-blue-400' : ''}`}
                          style={bg ? { background: bg, color: textColor } : undefined}
                        >
                          {valid ? (
                            <>
                              {`${n(bucket.carry_mean)} yds`}
                              {bucket.carry_std != null && (
                                <div className="text-xs font-normal" style={subTextColor}>±{n(bucket.carry_std)} carry</div>
                              )}
                              {bucket.side_carry_std != null && (
                                <div className="text-xs font-normal" style={subTextColor}>±{n(bucket.side_carry_std)} lateral</div>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="text-slate-700">—</span>
                              {bucket && bucket.n > 0 && (
                                <div className="text-xs text-gray-400 font-normal">({bucket.n} shots)</div>
                              )}
                            </>
                          )}
                        </td>
                        <td
                          key={`${row.club_type}-${b}-speed`}
                          className="px-3 py-3 text-center text-slate-400 text-xs"
                        >
                          {valid ? (
                            <>
                              <div>{n(bucket.speed_mean)} mph</div>
                              <div className="text-slate-600">n={bucket.n}</div>
                            </>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                      </>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
