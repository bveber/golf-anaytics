import React, { useEffect, useState } from 'react'
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, Line,
} from 'recharts'
import { api } from '../api'
import type { SwingEffortThreshold, SwingEffortBucket, SpeedHistogram } from '../api'
import { useBag } from '../BagContext'

interface CalibrateOneResult {
  club_type: string
  shot_count: number
  k: number
  gvf: number
  breaks: number[]
}

interface CalibrateAllResult {
  calibrated: CalibrateOneResult[]
}

interface DiffRow {
  club_type: string
  oldBucketCount: number
  newBucketCount: number
  oldBoundaries: number[]
  newBoundaries: number[]
}

interface DiffModalProps {
  rows: DiffRow[]
  onApply: () => void
  onCancel: () => Promise<void>
}

function gvfColorClass(gvf: number): string {
  if (gvf >= 0.85) return 'text-green-400'
  if (gvf >= 0.70) return 'text-amber-400'
  return 'text-red-400'
}

function DiffModal({ rows, onApply, onCancel }: DiffModalProps): React.ReactElement {
  const [reverting, setReverting] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-2xl w-full mx-4">
        <h2 className="text-white font-semibold text-lg mb-1">Calibration Preview</h2>
        {rows.length === 0 ? (
          <p className="text-slate-400 text-sm mb-4">No thresholds changed.</p>
        ) : (
          <>
            <p className="text-slate-400 text-sm mb-4">{rows.length} club{rows.length !== 1 ? 's' : ''} changed — review before keeping.</p>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-slate-700">
                    <th className="pb-2 pr-4">Club</th>
                    <th className="pb-2 pr-4">Buckets</th>
                    <th className="pb-2">Boundaries (mph)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.club_type} className="border-b border-slate-800">
                      <td className="py-2 pr-4 font-medium text-white">{r.club_type}</td>
                      <td className="py-2 pr-4 text-slate-300">
                        <span className="text-slate-500">{r.oldBucketCount}</span>
                        <span className="text-slate-500 mx-1">→</span>
                        <span className="text-green-400">{r.newBucketCount}</span>
                      </td>
                      <td className="py-2 font-mono text-xs">
                        <div className="text-slate-500">{r.oldBoundaries.length ? r.oldBoundaries.map((b) => b.toFixed(1)).join(', ') : '—'}</div>
                        <div className="text-green-400">{r.newBoundaries.length ? r.newBoundaries.map((b) => b.toFixed(1)).join(', ') : '—'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={async () => { setReverting(true); await onCancel(); setReverting(false) }}
            disabled={reverting}
            className="px-4 py-2 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 disabled:opacity-50 rounded text-sm"
          >
            {reverting ? 'Reverting…' : 'Cancel'}
          </button>
          <button
            onClick={onApply}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded text-sm font-medium"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

// 8-color palette: index 1 = lowest (red), index N = highest/full effort (blue)
const BUCKET_PALETTE = ['#f87171', '#fb923c', '#facc15', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#818cf8']

function bucketColor(index: number, total: number): string {
  if (total <= 1) return BUCKET_PALETTE[6]
  const pos = Math.round(((index - 1) / Math.max(total - 1, 1)) * (BUCKET_PALETTE.length - 1))
  return BUCKET_PALETTE[Math.min(pos, BUCKET_PALETTE.length - 1)]
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

function bucketIndexForSpeed(speed: number, buckets: SwingEffortBucket[]): number {
  for (let i = buckets.length - 1; i > 0; i--) {
    if (speed > buckets[i].lower_bound) return buckets[i].bucket_index
  }
  return buckets[0]?.bucket_index ?? 1
}

function ThresholdRow({
  t,
  index,
  isSelected,
  onSelect,
  onSaved,
  onCalibrate,
  gvf,
}: {
  t: SwingEffortThreshold
  index: number
  isSelected: boolean
  onSelect: () => void
  onSaved: (updated: SwingEffortThreshold) => void
  onCalibrate: () => void
  gvf: number | null
}) {
  const [editing, setEditing] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Edit state: internal boundaries only (k-1 values between buckets)
  const [boundaryInputs, setBoundaryInputs] = useState<string[]>([])

  const startEdit = () => {
    const internals = t.buckets.slice(1).map((b) => b.lower_bound.toFixed(1))
    setBoundaryInputs(internals)
    setErr(null)
    setEditing(true)
  }
  const cancel = () => { setEditing(false); setErr(null) }

  const save = async () => {
    const parsed = boundaryInputs.map((v) => parseFloat(v))
    if (parsed.some(isNaN)) { setErr('All values must be numbers'); return }
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i] <= parsed[i - 1]) { setErr('Boundaries must be strictly increasing'); return }
    }
    setSaving(true)
    setErr(null)
    try {
      await api.updateSwingEffortThresholds(t.club_type, parsed)
      const updated = await api.swingEffortThresholds()
      const match = updated.find((u) => u.club_type === t.club_type)
      if (match) onSaved(match)
      setEditing(false)
    } catch {
      setErr('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const rowBg = index % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'
  const k = t.buckets.length

  if (editing) {
    return (
      <tr className={`${rowBg} text-slate-200`}>
        <td className="px-4 py-2">
          <span className="font-medium text-white">{t.club_type}</span>
          <div><span className="text-sm text-gray-400">(n={t.shot_count} shots)</span></div>
        </td>
        <td className="px-4 py-2 text-slate-400 text-sm">
          {k} buckets · adjust internal boundaries (mph):
          <div className="flex flex-wrap gap-2 mt-1">
            {boundaryInputs.map((val, i) => (
              <input
                key={i}
                type="number"
                step="0.5"
                value={val}
                onChange={(e) => setBoundaryInputs((prev) => { const n = [...prev]; n[i] = e.target.value; return n })}
                className="w-20 text-right bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
                autoFocus={i === 0}
              />
            ))}
          </div>
          {err && <div className="text-red-400 text-xs mt-1">{err}</div>}
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-2 justify-end">
            <button onClick={save} disabled={saving}
              className="text-xs px-2 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded">
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={cancel}
              className="text-xs px-2 py-1 border border-slate-600 text-slate-400 hover:text-white rounded">
              Cancel
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`${rowBg} text-slate-200`}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{t.club_type}</span>
          {gvf != null && (
            <span
              className={`text-xs font-mono ${gvfColorClass(gvf)}`}
              title="Goodness of Variance Fit — higher means cleaner bucket separation."
            >
              GVF: {gvf.toFixed(2)}
            </span>
          )}
        </div>
        <span className="text-sm text-gray-400">(n={t.shot_count} shots)</span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {t.buckets.map((b) => (
            <span
              key={b.bucket_index}
              className="text-xs px-2 py-0.5 rounded font-mono"
              style={{ background: bucketColor(b.bucket_index, k) + '33', color: bucketColor(b.bucket_index, k), border: `1px solid ${bucketColor(b.bucket_index, k)}66` }}
            >
              {b.label}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 justify-end">
          <button onClick={startEdit}
            className="text-xs px-2 py-1 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 rounded">
            Edit
          </button>
          <button
            onClick={async () => { setCalibrating(true); try { await onCalibrate() } finally { setCalibrating(false) } }}
            disabled={calibrating}
            className="text-xs px-2 py-1 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 disabled:opacity-50 rounded"
          >
            {calibrating ? '…' : 'Calibrate'}
          </button>
          <button
            onClick={onSelect}
            className={`text-xs px-2 py-1 rounded ${
              isSelected
                ? 'bg-green-700 text-white'
                : 'text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400'
            }`}
          >
            Histogram
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function SwingEffort() {
  const [thresholds, setThresholds] = useState<SwingEffortThreshold[]>([])
  const [selectedClub, setSelectedClub] = useState<string | null>(null)
  const [histogram, setHistogram] = useState<SpeedHistogram | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gvfMap, setGvfMap] = useState<Record<string, number>>({})
  const [diffRows, setDiffRows] = useState<DiffRow[] | null>(null)
  const [preCalibrationThresholds, setPreCalibrationThresholds] = useState<SwingEffortThreshold[]>([])
  const { disabledClubs } = useBag()

  const disabledParam = disabledClubs.size > 0 ? [...disabledClubs].join(',') : undefined

  const load = () => {
    api.swingEffortThresholds(disabledParam).then(setThresholds).catch(() => setError('Failed to load thresholds'))
  }

  useEffect(() => { load() }, [disabledClubs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedClub) return
    api.speedHistogram(selectedClub, disabledParam).then(setHistogram).catch(() => setHistogram(null))
  }, [selectedClub, disabledClubs])

  const handleCalibrate = async () => {
    setCalibrating(true)
    setError(null)
    // Snapshot current thresholds before calibration runs
    const before = thresholds
    setPreCalibrationThresholds(before)
    try {
      const result = (await api.swingEffortCalibrate()) as CalibrateAllResult
      const after = await api.swingEffortThresholds(disabledParam)
      setThresholds(after)

      // Update GVF map from calibration results
      const newGvf: Record<string, number> = { ...gvfMap }
      for (const r of result.calibrated) {
        newGvf[r.club_type] = r.gvf
      }
      setGvfMap(newGvf)

      // Build diff: clubs where bucket count or internal boundaries changed
      const rows: DiffRow[] = []
      for (const afterThreshold of after) {
        const beforeThreshold = before.find((b) => b.club_type === afterThreshold.club_type)
        const oldBuckets = beforeThreshold?.buckets ?? []
        const newBuckets = afterThreshold.buckets
        const oldBounds = oldBuckets.slice(1).map((b) => b.lower_bound)
        const newBounds = newBuckets.slice(1).map((b) => b.lower_bound)
        const changed =
          oldBuckets.length !== newBuckets.length ||
          oldBounds.some((v, i) => Math.abs(v - (newBounds[i] ?? 0)) > 0.05)
        if (changed) {
          rows.push({
            club_type: afterThreshold.club_type,
            oldBucketCount: oldBuckets.length,
            newBucketCount: newBuckets.length,
            oldBoundaries: oldBounds,
            newBoundaries: newBounds,
          })
        }
      }
      setDiffRows(rows)

      if (selectedClub) {
        const h = await api.speedHistogram(selectedClub, disabledParam)
        setHistogram(h)
      }
    } catch {
      setError('Calibration failed — is the API running?')
    } finally {
      setCalibrating(false)
    }
  }

  const handleDiffApply = () => {
    setDiffRows(null)
    setPreCalibrationThresholds([])
  }

  // Revert to pre-calibration state by re-applying old boundaries for each changed club
  const handleDiffCancel = async () => {
    const changed = diffRows ?? []
    for (const row of changed) {
      const old = preCalibrationThresholds.find((t) => t.club_type === row.club_type)
      if (old) {
        const internalBounds = old.buckets.slice(1).map((b) => b.lower_bound)
        await api.updateSwingEffortThresholds(old.club_type, internalBounds)
      }
    }
    const restored = await api.swingEffortThresholds(disabledParam)
    setThresholds(restored)
    if (selectedClub) {
      const h = await api.speedHistogram(selectedClub, disabledParam)
      setHistogram(h)
    }
    setDiffRows(null)
    setPreCalibrationThresholds([])
  }

  const handleCalibrateOne = async (clubType: string) => {
    setError(null)
    try {
      const result = (await api.swingEffortCalibrateOne(clubType)) as CalibrateAllResult
      const calibrated = result.calibrated.find((r) => r.club_type === clubType)
      if (calibrated != null) {
        setGvfMap((prev) => ({ ...prev, [clubType]: calibrated.gvf }))
      }
      load()
      if (selectedClub === clubType) {
        const h = await api.speedHistogram(clubType, disabledParam)
        setHistogram(h)
      }
    } catch {
      setError(`Calibration failed for ${clubType}`)
    }
  }

  const handleSaved = async (updated: SwingEffortThreshold) => {
    setThresholds((prev) => prev.map((t) => t.club_type === updated.club_type ? updated : t))
    if (selectedClub === updated.club_type) {
      const h = await api.speedHistogram(updated.club_type, disabledParam)
      setHistogram(h)
    }
  }

  const chartThresholds = histogram?.thresholds ?? null
  const carryReg = linearRegression(
    (histogram?.bins ?? [])
      .filter((b) => b.carry != null)
      .map((b) => ({ x: (b.lo + b.hi) / 2, y: b.carry! }))
  )
  const chartData = histogram?.bins.map((b) => {
    const midpoint = (b.lo + b.hi) / 2
    const bucketIdx = chartThresholds ? bucketIndexForSpeed(midpoint, chartThresholds) : null
    return {
      label: `${Math.round(b.lo)}`,
      midpoint,
      count: b.count,
      bucketIdx,
      carry: b.carry,
      apex: b.apex,
      side_carry: b.side_carry,
      total_distance: b.total_distance,
      regCarry: carryReg != null ? carryReg.slope * midpoint + carryReg.intercept : undefined,
    }
  }) ?? []

  const kTotal = chartThresholds?.length ?? 0

  return (
    <div>
      {diffRows != null && (
        <DiffModal
          rows={diffRows}
          onApply={handleDiffApply}
          onCancel={handleDiffCancel}
        />
      )}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">Swing Effort</h1>
        <button
          onClick={handleCalibrate}
          disabled={calibrating}
          className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
        >
          {calibrating ? 'Calibrating…' : 'Run All Calibrations'}
        </button>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Calibration uses Fisher-Jenks natural breaks to find the optimal number of speed buckets (2–8) per club type.
        Click <strong className="text-slate-300">Edit</strong> to manually adjust internal boundaries.
        Click <strong className="text-slate-300">Histogram</strong> to validate visually.
      </p>

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      {thresholds.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="mb-2">No calibration data yet.</p>
          <p className="text-sm">Click "Run All Calibrations" to classify your shots.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-700 mb-8">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400 text-left">
                <tr>
                  <th className="px-4 py-3">Club</th>
                  <th className="px-4 py-3">Speed Buckets (mph) — low → high effort</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {thresholds.map((t, i) => (
                  <ThresholdRow
                    key={t.club_type}
                    t={t}
                    index={i}
                    isSelected={selectedClub === t.club_type}
                    onSelect={() => setSelectedClub(t.club_type)}
                    onSaved={handleSaved}
                    onCalibrate={() => handleCalibrateOne(t.club_type)}
                    gvf={gvfMap[t.club_type] ?? null}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {selectedClub && histogram && (
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
              <h2 className="text-white font-semibold mb-1">
                Club Speed Distribution — <span className="text-green-400">{selectedClub}</span>
              </h2>
              <p className="text-slate-400 text-xs mb-4">
                {histogram.total} shots · bar color = effort bucket · dashed lines = bucket boundaries
              </p>
              {chartThresholds && (
                <div className="flex flex-wrap gap-3 mb-4 text-xs">
                  {chartThresholds.map((b) => (
                    <span key={b.bucket_index} className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: bucketColor(b.bucket_index, kTotal) }} />
                      <span className="text-slate-300">{b.label}</span>
                    </span>
                  ))}
                </div>
              )}
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 48, bottom: 20, left: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis
                    dataKey="label"
                    ticks={chartData.map(d => d.label)}
                    interval={0}
                    tick={{ fill: '#94a3b8', fontSize: 9, angle: -45, textAnchor: 'end', dy: 4 }}
                    height={40}
                    label={{ value: 'Club Speed (mph)', position: 'insideBottomRight', offset: -4, fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis yAxisId="count" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis yAxisId="carry" orientation="right" tick={{ fill: '#f59e0b', fontSize: 10 }} label={{ value: 'Carry (yds)', angle: 90, position: 'insideRight', offset: 12, fill: '#f59e0b', fontSize: 10 }} />
                  <Tooltip
                    content={(props) => {
                      const { active, payload } = props as unknown as { active?: boolean; payload?: { payload: typeof chartData[0] }[] }
                      if (!active || !payload?.length) return <></>
                      const d = payload[0].payload
                      const color = d.bucketIdx != null ? bucketColor(d.bucketIdx, kTotal) : '#94a3b8'
                      const bucketLabel = chartThresholds?.find((b) => b.bucket_index === d.bucketIdx)?.label ?? '—'
                      return (
                        <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                          <div className="text-slate-300 font-medium mb-1">~{d.label} mph</div>
                          <div className="text-slate-400">{d.count} shots · <span style={{ color }}>{bucketLabel}</span></div>
                          {d.carry != null && <div className="text-slate-300 mt-1">Carry: {d.carry} yd</div>}
                          {d.regCarry != null && <div style={{ color: '#f59e0b' }}>Carry fit: {d.regCarry.toFixed(1)} yd</div>}
                          {d.total_distance != null && <div className="text-slate-300">Total: {d.total_distance} yd</div>}
                          {d.side_carry != null && <div className="text-slate-300">Side: {d.side_carry > 0 ? `${d.side_carry} yd R` : `${Math.abs(d.side_carry)} yd L`}</div>}
                          {d.apex != null && <div className="text-slate-300">Apex: {d.apex} ft</div>}
                        </div>
                      )
                    }}
                  />
                  {chartThresholds && chartThresholds.slice(1).map((b) => (
                    <ReferenceLine
                      key={b.bucket_index}
                      yAxisId="count"
                      x={String(Math.round(b.lower_bound))}
                      stroke={bucketColor(b.bucket_index, kTotal)}
                      strokeDasharray="4 3"
                      label={{ value: b.label, fill: bucketColor(b.bucket_index, kTotal), fontSize: 9 }}
                    />
                  ))}
                  <Bar yAxisId="count" dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.bucketIdx != null ? bucketColor(entry.bucketIdx, kTotal) : '#64748b'} />
                    ))}
                  </Bar>
                  {carryReg != null && (
                    <Line
                      yAxisId="carry"
                      dataKey="regCarry"
                      type="linear"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                      legendType="none"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
