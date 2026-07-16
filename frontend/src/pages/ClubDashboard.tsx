import { useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine, Legend,
} from 'recharts'
import { api } from '../api'
import type { ClubStats, TrendPoint, ClubOption, Shot, SwingEffortBucket, UserSettings } from '../api'
import { computeEllipses } from '../utils/ellipse'
import type { EllipseResult } from '../utils/ellipse'
import { useBag } from '../BagContext'
import { useAdjusted } from '../hooks/useAdjusted'
import AdjustedToggle from '../components/AdjustedToggle'
import AdjustedFootnote from '../components/AdjustedFootnote'

const CLUB_ORDER = ['d', '3w', '5w', '7w', '2h', '3h', '4h', '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'pw', 'gw', 'sw', 'lw']

function sortClubs<T extends { club_type: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ai = CLUB_ORDER.indexOf(a.club_type)
    const bi = CLUB_ORDER.indexOf(b.club_type)
    const aPos = ai === -1 ? 999 : ai
    const bPos = bi === -1 ? 999 : bi
    return aPos - bPos
  })
}

type SortDir = 'asc' | 'desc'
interface SortState { key: string; dir: SortDir }

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block ${active ? 'text-green-400' : 'text-slate-600'}`}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  )
}

const TREND_METRICS = [
  { key: 'carry_distance', label: 'Carry (yds)' },
  { key: 'total_distance', label: 'Total Distance (yds)' },
  { key: 'ball_speed', label: 'Ball Speed (mph)' },
  { key: 'club_speed', label: 'Club Speed (mph)' },
  { key: 'smash_factor', label: 'Smash Factor' },
  { key: 'launch_angle', label: 'Launch Angle (°)' },
  { key: 'launch_direction', label: 'Launch Direction (°)' },
  { key: 'spin_rate', label: 'Spin Rate (rpm)' },
  { key: 'spin_axis', label: 'Spin Axis (°)' },
  { key: 'side_carry', label: 'Side Carry (yds)' },
  { key: 'apex', label: 'Apex (yds)' },
  { key: 'descent_angle', label: 'Descent Angle (°)' },
  { key: 'attack_angle', label: 'Attack Angle (°)' },
  { key: 'club_path', label: 'Club Path (°)' },
]

// ── Linear regression ─────────────────────────────────────────────────────

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

function rSquared(pts: { x: number; y: number }[], slope: number, intercept: number): number {
  const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const ssTot = pts.reduce((s, p) => s + (p.y - meanY) ** 2, 0)
  const ssRes = pts.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0)
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

function clientMean(vals: number[]): number | null {
  return vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0) / vals.length
}

function clientStd(vals: number[]): number | null {
  if (vals.length < 2) return null
  const m = vals.reduce((s, v) => s + v, 0) / vals.length
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1))
}

type NumericShotKey = {
  [K in keyof Shot]: Shot[K] extends number | null ? K : never
}[keyof Shot]

function statsFromShots(shots: Shot[]): ClubStats | null {
  const clean = shots.filter((s) => !s.is_outlier)
  if (clean.length === 0) return null
  const nums = (key: NumericShotKey): number[] =>
    clean.map((s) => s[key]).filter((v): v is number => typeof v === 'number')
  return {
    club: clean[0].club ?? '',
    club_type: clean[0].club_type ?? null,
    shot_count: clean.length,
    carry_mean:            clientMean(nums('carry_distance')),
    carry_std:             clientStd(nums('carry_distance')),
    total_mean:            clientMean(nums('total_distance')),
    total_std:             clientStd(nums('total_distance')),
    ball_speed_mean:       clientMean(nums('ball_speed')),
    spin_rate_mean:        clientMean(nums('spin_rate')),
    smash_factor_mean:     clientMean(nums('smash_factor')),
    side_carry_mean:       clientMean(nums('side_carry')),
    side_carry_std:        clientStd(nums('side_carry')),
    launch_angle_mean:     clientMean(nums('launch_angle')),
    club_speed_mean:       clientMean(nums('club_speed')),
    spin_axis_mean:        clientMean(nums('spin_axis')),
    club_path_mean:        clientMean(nums('club_path')),
    attack_angle_mean:     clientMean(nums('attack_angle')),
    launch_direction_mean: clientMean(nums('launch_direction')),
    apex_mean:             clientMean(nums('apex')),
    carry_mean_adj:        clientMean(nums('carry_distance_adj')),
    total_mean_adj:        clientMean(nums('total_distance_adj')),
    ball_speed_mean_adj:   clientMean(nums('ball_speed_adj')),
    club_speed_mean_adj:   clientMean(nums('club_speed_adj')),
  }
}

// ── Local types ───────────────────────────────────────────────────────────

interface Point { x: number; y: number }
interface ShotPoint extends Point { club_speed: number | null }

// 8-color palette: index 1 = red (lowest effort), index N = blue (full effort)
const BUCKET_PALETTE = ['#f87171', '#fb923c', '#facc15', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#818cf8']

function bucketColor(index: number, total: number): string {
  if (total <= 1) return BUCKET_PALETTE[6]
  const pos = Math.round(((index - 1) / Math.max(total - 1, 1)) * (BUCKET_PALETTE.length - 1))
  return BUCKET_PALETTE[Math.min(pos, BUCKET_PALETTE.length - 1)]
}

interface EffortDispersion {
  effortKey: string
  label: string
  color: string
  pts: ShotPoint[]
  ellipses: EllipseResult | null
  speedMin: number | null
  speedMax: number | null
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className="text-white text-xl font-bold">{value}</div>
    </div>
  )
}

function CarryRangeCard({ p10, p50, p90 }: { p10: number; p50: number; p90: number }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="text-slate-400 text-xs mb-1">Carry</div>
      <div className="text-white text-xl font-bold">{Math.round(p50)} yds</div>
      <div className="text-slate-400 text-xs mt-1">{Math.round(p10)}–{Math.round(p90)} yds (P10–P90)</div>
    </div>
  )
}

function MissCard({ mean, std }: { mean: number | null; std: number | null }) {
  if (mean == null) return <StatCard label="Miss Tendency" value="—" />
  const absMean = Math.abs(mean)
  const isSignificant = absMean > 2
  const dir = mean > 0 ? 'right' : 'left'
  const colorClass = !isSignificant ? 'text-slate-300' : mean > 0 ? 'text-amber-400' : 'text-sky-400'
  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="text-slate-400 text-xs mb-1">Miss Tendency</div>
      <div className={`text-xl font-bold ${colorClass}`}>
        {isSignificant ? `${mean >= 0 ? '+' : ''}${mean.toFixed(1)} yds ${dir}` : 'Straight'}
      </div>
      {std != null && (
        <div className="text-slate-400 text-xs mt-1">±{std.toFixed(1)} yds dispersion</div>
      )}
    </div>
  )
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function n(v: number | null, dec = 1) {
  return v == null ? '—' : v.toFixed(dec)
}

// ── Page ──────────────────────────────────────────────────────────────────

interface DispersionPoint {
  session_date: string
  session_id: string
  side_std: number | null
  carry_std: number | null
  shot_count: number
}

// ── Memoized heavy sections ────────────────────────────────────────────────

interface SessionsTrendChartProps {
  trendWithBands: Array<{
    session_id: string
    session_date: string
    mean: number | null
    std: number | null
    shot_count: number
    lower: number
    bandWidth: number
    speed_mean: number | null
    speed_min: number | null
    speed_max: number | null
  }>
  speedTrend: TrendPoint[]
  metric: string
  onMetricChange: (m: string) => void
}

const SessionsTrendChart = memo(function SessionsTrendChart({
  trendWithBands, speedTrend, metric, onMetricChange,
}: SessionsTrendChartProps) {
  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-white font-semibold">Sessions</h2>
        <select
          value={metric}
          onChange={(e) => onMetricChange(e.target.value)}
          className="bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-600"
        >
          {TREND_METRICS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>
      <p className="text-slate-500 text-xs mb-3">
        <span className="text-green-400">—</span>{' '}
        {TREND_METRICS.find((m) => m.key === metric)?.label ?? metric}
        &nbsp;·&nbsp; shaded band = ±1 std dev
        {speedTrend.length > 0 && (
          <>&nbsp;·&nbsp;<span className="text-sky-400">— — —</span> club speed (right axis)</>
        )}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={trendWithBands} margin={{ top: 4, right: 48, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="session_date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['auto', 'auto']} />
          {speedTrend.length > 0 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: '#60a5fa', fontSize: 10 }}
              domain={['auto', 'auto']}
              width={40}
              label={{ value: 'mph', position: 'insideRight', fill: '#60a5fa', fontSize: 10, offset: 8 }}
            />
          )}
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6 }}
            labelStyle={{ color: '#94a3b8' }}
            labelFormatter={(d) => fmtDate(String(d))}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload as SessionsTrendChartProps['trendWithBands'][0] | undefined
              if (!d) return null
              const metricLabel = TREND_METRICS.find((m) => m.key === metric)?.label ?? metric
              return (
                <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                  <div className="text-slate-400 mb-1">{fmtDate(String(label))}</div>
                  <div className="text-slate-300">
                    {metricLabel}: <span className="text-white font-medium">{d.mean != null ? d.mean.toFixed(1) : '—'}</span>
                    {d.std != null && d.std > 0 && <span className="text-slate-500"> ±{d.std.toFixed(1)}</span>}
                  </div>
                  {d.speed_mean != null && (
                    <div className="text-slate-300 mt-0.5">
                      Club speed: <span className="text-sky-300 font-medium">{d.speed_mean.toFixed(1)} mph</span>
                      {d.speed_min != null && d.speed_max != null && (
                        <span className="text-slate-500"> ({d.speed_min.toFixed(0)}–{d.speed_max.toFixed(0)})</span>
                      )}
                    </div>
                  )}
                  <div className="text-slate-500 mt-0.5">{d.shot_count} shots</div>
                </div>
              )
            }}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="lower"
            fill="transparent"
            stroke="none"
            stackId="band"
            legendType="none"
            isAnimationActive={false}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="bandWidth"
            fill="#4ade80"
            fillOpacity={0.12}
            stroke="none"
            stackId="band"
            legendType="none"
            isAnimationActive={false}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="mean"
            stroke="#4ade80"
            strokeWidth={2}
            dot={{ r: 4, fill: '#4ade80' }}
            activeDot={{ r: 6 }}
            legendType="none"
          />
          {speedTrend.length > 0 && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="speed_mean"
              stroke="#60a5fa"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={{ r: 3, fill: '#60a5fa' }}
              activeDot={{ r: 5 }}
              connectNulls
              legendType="none"
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

interface EffortDispersionSectionProps {
  effortDisp: EffortDispersion[]
}

const EffortDispersionSection = memo(function EffortDispersionSection({
  effortDisp,
}: EffortDispersionSectionProps) {
  if (effortDisp.length < 2) return null
  return (
    <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-700">
      <div className="mb-4">
        <h2 className="text-white font-semibold">Dispersion by Swing Effort</h2>
        <p className="text-slate-500 text-xs mt-1">50% · 75% · 95% confidence ellipses per effort level · outliers excluded</p>
        {(() => {
          const lowest = effortDisp[0]
          const highest = effortDisp[effortDisp.length - 1]
          if (!lowest?.ellipses || !highest?.ellipses) return null
          const deltaCarry = highest.ellipses.cy - lowest.ellipses.cy
          // Use the 50% ellipse x-spread as the dispersion proxy (first entry in the array)
          const lowestRx = lowest.ellipses.ellipses[0]?.points.reduce((max, p) => Math.max(max, Math.abs(p.x - lowest.ellipses!.cx)), 0) ?? 0
          const highestRx = highest.ellipses.ellipses[0]?.points.reduce((max, p) => Math.max(max, Math.abs(p.x - highest.ellipses!.cx)), 0) ?? 0
          const dispersalRatio = lowestRx > 0.1 ? highestRx / lowestRx : null
          return (
            <p className="text-slate-400 text-xs mt-1">
              {highest.label}: <span className="text-white">{deltaCarry >= 0 ? '+' : ''}{deltaCarry.toFixed(0)} yds carry</span> vs {lowest.label}
              {dispersalRatio != null && (
                <>, <span className="text-white">{dispersalRatio.toFixed(1)}×</span> lateral spread</>
              )}
            </p>
          )
        })()}
      </div>
      <div className={`grid gap-4 ${effortDisp.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' : effortDisp.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
        {effortDisp.map(({ effortKey, label, color, pts, ellipses: ell, speedMin, speedMax }) => (
          <div key={effortKey} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-semibold" style={{ color }}>{label}</span>
                {speedMin != null && speedMax != null && (
                  <span className="text-slate-400 text-xs ml-2">{speedMin.toFixed(0)}–{speedMax.toFixed(0)} mph</span>
                )}
              </div>
              {ell && (
                <span className="text-slate-500 text-xs">{ell.inlierCount}/{pts.length} shots</span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 4, right: 12, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Side Carry"
                  label={{ value: 'Side (yds)', position: 'bottom', fill: '#94a3b8', fontSize: 10 }}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Carry"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  domain={['auto', 'auto']}
                  width={38}
                />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as ShotPoint
                    return (
                      <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
                        <div className="text-slate-300">Carry: <span className="text-white">{d.y.toFixed(1)} yds</span></div>
                        <div className="text-slate-300">Side: <span className="text-white">{d.x.toFixed(1)} yds</span></div>
                        <div className="text-slate-300">Club Speed: <span className="text-white">{d.club_speed != null ? `${d.club_speed.toFixed(1)} mph` : '—'}</span></div>
                      </div>
                    )
                  }}
                />
                <ReferenceLine x={0} stroke="#475569" />
                <Scatter data={pts} fill={color} fillOpacity={0.7} isAnimationActive={false} />
                {ell && (
                  <>
                    <Scatter
                      data={ell.ellipses[2].points}
                      line={{ stroke: 'rgba(255,255,255,0.65)', strokeWidth: 1.5, strokeDasharray: '4 2' }}
                      shape={() => null as unknown as React.ReactElement}
                      fill="transparent"
                      isAnimationActive={false}
                      legendType="none"
                    />
                    <Scatter
                      data={ell.ellipses[1].points}
                      line={{ stroke: 'rgba(255,255,255,0.82)', strokeWidth: 2.5, strokeDasharray: '6 2' }}
                      shape={() => null as unknown as React.ReactElement}
                      fill="transparent"
                      isAnimationActive={false}
                      legendType="none"
                    />
                    <Scatter
                      data={ell.ellipses[0].points}
                      line={{ stroke: 'rgba(255,255,255,1.0)', strokeWidth: 3 }}
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
        ))}
      </div>
    </div>
  )
})

// clubBuckets is passed so the prop signature is stable — the component uses it only in the IIFE-turned-body
interface StoppingPowerTableProps {
  viewShots: Shot[]
  clubBuckets: SwingEffortBucket[]
}

const StoppingPowerTable = memo(function StoppingPowerTable({ viewShots, clubBuckets }: StoppingPowerTableProps) {
  if (!viewShots.some((s) => s.roll_medium_standard != null)) return null
  const totalBuckets = clubBuckets.length
  const effortKeys = [...new Set(viewShots.map((s) => s.swing_effort).filter((e): e is string => e != null && e !== 'unknown'))]
    .sort((a, b) => parseInt(a) - parseInt(b))
  const effortRows = effortKeys.flatMap((effortKey) => {
    const group = viewShots.filter((s) => s.swing_effort === effortKey && !s.is_outlier && s.roll_medium_standard != null)
    if (group.length === 0) return []
    const avg = (arr: (number | null)[]) => {
      const vals = arr.filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    const bucketIdx = parseInt(effortKey)
    const label = clubBuckets.find((b) => b.bucket_index === bucketIdx)?.label ?? `Bucket ${effortKey}`
    return [{
      effortKey,
      label,
      color: bucketColor(bucketIdx, totalBuckets || effortKeys.length),
      n: group.length,
      rollStd: avg(group.map((s) => s.roll_medium_standard)),
      rollFly: avg(group.map((s) => s.roll_medium_flyer)),
      flyCarry: avg(group.map((s) => s.flyer_carry_est)),
      carry: avg(group.map((s) => s.carry_distance)),
    }]
  })
  if (effortRows.length === 0) return null
  return (
    <div className="mt-6 bg-slate-900 rounded-lg border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700">
        <h2 className="text-white font-semibold">Stopping Power by Swing Effort</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Roll and carry estimates on medium greens · outliers excluded
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-800 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2">Effort</th>
              <th className="px-4 py-2 text-right">Shots</th>
              <th className="px-4 py-2 text-right">Carry (yds)</th>
              <th className="px-4 py-2 text-right">Roll · Std Lie (ft)</th>
              <th className="px-4 py-2 text-right">Roll · Flyer Lie (ft)</th>
              <th className="px-4 py-2 text-right">Flyer Carry Est (yds)</th>
            </tr>
          </thead>
          <tbody>
            {effortRows.map((row, i) => (
              <tr
                key={row.effortKey}
                className={i % 2 === 0 ? 'bg-slate-900 text-slate-200' : 'bg-slate-950 text-slate-200'}
              >
                <td className="px-4 py-2 font-semibold" style={{ color: row.color }}>
                  {row.label}
                </td>
                <td className="px-4 py-2 text-right text-slate-400">{row.n}</td>
                <td className="px-4 py-2 text-right">{n(row.carry)}</td>
                <td className="px-4 py-2 text-right">
                  <span className={row.rollStd != null && row.rollStd < 0 ? 'text-cyan-400' : ''}>
                    {row.rollStd != null ? (row.rollStd >= 0 ? '+' : '') + n(row.rollStd) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-amber-300">
                  {row.rollFly != null ? '+' + n(row.rollFly) : '—'}
                </td>
                <td className="px-4 py-2 text-right text-amber-300">
                  {n(row.flyCarry)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

interface DispersionTrendChartProps {
  dispTrend: DispersionPoint[]
}

const DispersionTrendChart = memo(function DispersionTrendChart({ dispTrend }: DispersionTrendChartProps) {
  if (dispTrend.length <= 1) return null
  return (
    <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-700">
      <div className="mb-4">
        <h2 className="text-white font-semibold">Dispersion Over Time</h2>
        <p className="text-slate-500 text-xs mt-1">
          Std dev of carry distance and side carry per session — lower = more consistent
        </p>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={dispTrend} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="session_date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            domain={[0, 'auto']}
            label={{ value: 'Std Dev (yds)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6 }}
            labelStyle={{ color: '#94a3b8' }}
            itemStyle={{ color: '#fff' }}
            labelFormatter={(d) => fmtDate(String(d))}
            formatter={(v, name) => [
              v != null ? `±${Number(v).toFixed(1)} yds` : '—',
              name === 'carry_std' ? 'Carry Std Dev' : 'Side Carry Std Dev',
            ]}
          />
          <Legend
            formatter={(value: string) =>
              value === 'carry_std' ? 'Carry Std Dev' : 'Side Carry Std Dev'
            }
            wrapperStyle={{ color: '#94a3b8', fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="carry_std"
            stroke="#4ade80"
            strokeWidth={2}
            dot={{ r: 3, fill: '#4ade80' }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="side_std"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 3, fill: '#60a5fa' }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})

export default function ClubDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [allClubs, setAllClubs] = useState<ClubOption[]>([])
  const [selectedClub, setSelectedClub] = useState<string>(() => searchParams.get('club') ?? '')
  const { isActive, disabledClubs } = useBag()
  const [settings, setSettings] = useState<UserSettings>({ elevation_ft: 900, temperature_f: 70 })
  const { adjusted, toggleAdjusted } = useAdjusted()
  const clubs = allClubs.filter((c) => isActive(c.club_type, c.club))
  const [metric, setMetric] = useState('carry_distance')
  const [trend, setTrend] = useState<TrendPoint[]>([])

  const [dispTrend, setDispTrend] = useState<DispersionPoint[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [speedTrend, setSpeedTrend] = useState<TrendPoint[]>([])

  const [clubBuckets, setClubBuckets] = useState<SwingEffortBucket[]>([])
  const [shotSort, setShotSort] = useState<SortState>({ key: 'session_date', dir: 'asc' })
  const [editing, setEditing] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [shotLogExpanded, setShotLogExpanded] = useState(false)
  const [recentDays, setRecentDays] = useState(14)
  const [enabledEfforts, setEnabledEfforts] = useState<Set<string>>(new Set())
  const [globalDateFrom, setGlobalDateFrom] = useState('')
  const [globalDateTo, setGlobalDateTo] = useState('')

  async function toggleOutlier(shot: Shot) {
    const newVal = !shot.is_outlier
    await api.updateOutlier(shot.shot_id, newVal, shot.outlier_note ?? undefined)
    setShots((prev) => prev.map((s) => s.shot_id === shot.shot_id ? { ...s, is_outlier: newVal } : s))
  }

  async function saveNote(shot: Shot) {
    await api.updateOutlier(shot.shot_id, shot.is_outlier, noteText || undefined)
    setShots((prev) => prev.map((s) => s.shot_id === shot.shot_id ? { ...s, outlier_note: noteText || null } : s))
    setEditing(null)
  }

  const toggleShotSort = (key: string) =>
    setShotSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  // Date-filtered shots (global date filter only)
  const viewShots = useMemo(() => shots.filter((s) => {
    if (globalDateFrom && s.session_date && s.session_date < globalDateFrom) return false
    if (globalDateTo   && s.session_date && s.session_date > globalDateTo)   return false
    return true
  }), [shots, globalDateFrom, globalDateTo])

  // Date + effort filtered shots. Shots with no swing_effort label are always included
  // since they cannot be assigned to an effort bucket (e.g. newly synced sessions).
  const filteredShots = useMemo(() => {
    if (enabledEfforts.size === 0 || clubBuckets.length === 0) return viewShots
    return viewShots.filter((s) => s.swing_effort == null || enabledEfforts.has(s.swing_effort))
  }, [viewShots, enabledEfforts, clubBuckets])

  const carryPercentiles = useMemo(() => {
    const vals = filteredShots
      .filter((s) => s.carry_distance != null && !s.is_outlier)
      .map((s) => adjusted ? (s.carry_distance_adj ?? s.carry_distance!) : s.carry_distance!)
      .sort((a, b) => a - b)
    if (vals.length < 3) return null
    const q1 = percentile(vals, 25)
    const q3 = percentile(vals, 75)
    const fence = 1.5 * (q3 - q1)
    const clean = vals.length >= 8 ? vals.filter((v) => v >= q1 - fence && v <= q3 + fence) : vals
    if (clean.length < 3) return null
    return { p10: percentile(clean, 10), p50: percentile(clean, 50), p90: percentile(clean, 90) }
  }, [filteredShots, adjusted])

  const sessionContext = useMemo(() => {
    if (filteredShots.length === 0) return null
    const sessionIds = new Set(filteredShots.map((s) => s.session_id))
    const dates = filteredShots.map((s) => s.session_date).filter((d): d is string => d !== null).sort()
    const dateRange = dates.length > 0
      ? dates[0] === dates[dates.length - 1]
        ? fmtDate(dates[0])
        : `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`
      : null
    return { sessionCount: sessionIds.size, dateRange }
  }, [filteredShots])

  const trendWithBands = useMemo(() => {
    const speedBySession = new Map(speedTrend.map((pt) => [pt.session_id, pt]))
    return trend.map((pt) => {
      const sp = speedBySession.get(pt.session_id)
      const lower = (pt.mean ?? 0) - (pt.std ?? 0)
      const bandWidth = 2 * (pt.std ?? 0)
      return {
        ...pt,
        lower,
        bandWidth,
        speed_mean: sp?.mean ?? null,
        speed_min: sp != null ? (sp.mean ?? 0) - (sp.std ?? 0) : null,
        speed_max: sp != null ? (sp.mean ?? 0) + (sp.std ?? 0) : null,
      }
    })
  }, [trend, speedTrend])

  const sortedShots = useMemo(() => {
    const { key, dir } = shotSort
    return [...filteredShots].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[key]
      const bv = (b as unknown as Record<string, unknown>)[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }, [filteredShots, shotSort])

  const stats = useMemo(() => statsFromShots(filteredShots), [filteredShots])

  const recentStats = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - recentDays)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const recent = filteredShots.filter((s) =>
      s.session_date != null && s.session_date >= cutoffStr &&
      (!globalDateTo || s.session_date <= globalDateTo)
    )
    return statsFromShots(recent)
  }, [filteredShots, recentDays, globalDateTo])

  const historicalStats = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - recentDays)
    cutoff.setDate(cutoff.getDate() - 1)
    const histCutoffStr = cutoff.toISOString().split('T')[0]
    const hist = filteredShots.filter((s) =>
      s.session_date != null && s.session_date <= histCutoffStr &&
      (!globalDateFrom || s.session_date >= globalDateFrom)
    )
    return statsFromShots(hist)
  }, [filteredShots, recentDays, globalDateFrom])

  type CompRow = {
    label: string
    hist: number | null
    recent: number | null
    valFmt: (v: number) => string
    deltaFmt: (d: number) => string
    direction: 'higher' | 'lower' | 'closer-to-zero' | 'neutral'
  }

  const comparisonRows = useMemo((): CompRow[] => [
    {
      label: adjusted ? '~Carry Distance' : 'Carry Distance',
      hist: adjusted ? (historicalStats?.carry_mean_adj ?? historicalStats?.carry_mean ?? null) : (historicalStats?.carry_mean ?? null),
      recent: adjusted ? (recentStats?.carry_mean_adj ?? recentStats?.carry_mean ?? null) : (recentStats?.carry_mean ?? null),
      valFmt: (v) => `${v.toFixed(1)} yds`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)} yds`,
      direction: 'higher',
    },
    {
      label: adjusted ? '~Ball Speed' : 'Ball Speed',
      hist: adjusted ? (historicalStats?.ball_speed_mean_adj ?? historicalStats?.ball_speed_mean ?? null) : (historicalStats?.ball_speed_mean ?? null),
      recent: adjusted ? (recentStats?.ball_speed_mean_adj ?? recentStats?.ball_speed_mean ?? null) : (recentStats?.ball_speed_mean ?? null),
      valFmt: (v) => `${v.toFixed(1)} mph`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)} mph`,
      direction: 'higher',
    },
    {
      label: adjusted ? '~Club Speed' : 'Club Speed',
      hist: adjusted ? (historicalStats?.club_speed_mean_adj ?? historicalStats?.club_speed_mean ?? null) : (historicalStats?.club_speed_mean ?? null),
      recent: adjusted ? (recentStats?.club_speed_mean_adj ?? recentStats?.club_speed_mean ?? null) : (recentStats?.club_speed_mean ?? null),
      valFmt: (v) => `${v.toFixed(1)} mph`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)} mph`,
      direction: 'higher',
    },
    {
      label: 'Smash Factor',
      hist: historicalStats?.smash_factor_mean ?? null,
      recent: recentStats?.smash_factor_mean ?? null,
      valFmt: (v) => v.toFixed(2),
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
      direction: 'higher',
    },
    {
      label: 'Spin Rate',
      hist: historicalStats?.spin_rate_mean ?? null,
      recent: recentStats?.spin_rate_mean ?? null,
      valFmt: (v) => `${Math.round(v).toLocaleString()} rpm`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${Math.round(d).toLocaleString()} rpm`,
      direction: 'neutral',
    },
    {
      label: 'Side Carry',
      hist: historicalStats?.side_carry_mean ?? null,
      recent: recentStats?.side_carry_mean ?? null,
      valFmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} yds`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)} yds`,
      direction: 'closer-to-zero',
    },
    {
      label: 'Lateral Dispersion',
      hist: historicalStats?.side_carry_std ?? null,
      recent: recentStats?.side_carry_std ?? null,
      valFmt: (v) => `±${v.toFixed(1)} yds`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)} yds`,
      direction: 'lower',
    },
    {
      label: 'Launch Angle',
      hist: historicalStats?.launch_angle_mean ?? null,
      recent: recentStats?.launch_angle_mean ?? null,
      valFmt: (v) => `${v.toFixed(1)}°`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°`,
      direction: 'neutral',
    },
    {
      label: 'Launch Direction',
      hist: historicalStats?.launch_direction_mean ?? null,
      recent: recentStats?.launch_direction_mean ?? null,
      valFmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°`,
      direction: 'closer-to-zero',
    },
    {
      label: 'Attack Angle',
      hist: historicalStats?.attack_angle_mean ?? null,
      recent: recentStats?.attack_angle_mean ?? null,
      valFmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°`,
      direction: 'neutral',
    },
    {
      label: 'Club Path',
      hist: historicalStats?.club_path_mean ?? null,
      recent: recentStats?.club_path_mean ?? null,
      valFmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°`,
      direction: 'closer-to-zero',
    },
    {
      label: 'Spin Axis',
      hist: historicalStats?.spin_axis_mean ?? null,
      recent: recentStats?.spin_axis_mean ?? null,
      valFmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`,
      deltaFmt: (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°`,
      direction: 'closer-to-zero',
    },
  ], [historicalStats, recentStats, adjusted])

  const effortProportions = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - recentDays)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const validShots = filteredShots.filter((s) => s.swing_effort != null && s.swing_effort !== 'unknown')
    const recentShots = validShots.filter((s) => s.session_date != null && s.session_date >= cutoffStr)
    const histShots = validShots.filter((s) => s.session_date != null && s.session_date < cutoffStr)
    const allKeys = [...new Set(validShots.map((s) => s.swing_effort as string))].sort((a, b) => parseInt(a) - parseInt(b))
    if (allKeys.length === 0) return null
    const toProps = (set: typeof filteredShots) => {
      const total = set.length
      const counts = new Map<string, number>()
      for (const s of set) counts.set(s.swing_effort!, (counts.get(s.swing_effort!) ?? 0) + 1)
      return allKeys.map((k) => ({ key: k, pct: total > 0 ? (counts.get(k) ?? 0) / total : 0 }))
    }
    return {
      keys: allKeys,
      recent: toProps(recentShots),
      historical: toProps(histShots),
      recentTotal: recentShots.length,
      histTotal: histShots.length,
    }
  }, [filteredShots, recentDays])

  useEffect(() => {
    api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    api.clubList().then((list) => {
      const sorted = sortClubs(list)
      setAllClubs(sorted)
      const fromUrl = searchParams.get('club')
      const target = fromUrl && sorted.some((c) => c.club_type === fromUrl && isActive(c.club_type, c.club))
        ? fromUrl
        : sorted.find((c) => isActive(c.club_type, c.club))?.club_type ?? ''
      setSelectedClub(target)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Effect A — fetch raw shots + thresholds
  useEffect(() => {
    if (!selectedClub) return
    const disabledParam = disabledClubs.size > 0 ? [...disabledClubs].join(',') : undefined
    Promise.all([
      api.shotsByClub(selectedClub, disabledParam ? { disabled_clubs: disabledParam } : undefined),
      api.swingEffortThresholds(),
    ]).then(([fetched, allThresholds]) => {
      setShots(fetched)
      const buckets = allThresholds.find((t) => t.club_type === selectedClub)?.buckets ?? []
      setClubBuckets(buckets)
      setEnabledEfforts(new Set(buckets.map((b) => String(b.bucket_index))))
    })
  }, [selectedClub, disabledClubs])

  // Derived: dispersion scatter points (replaces Effect B)
  const dispersion = useMemo(() => {
    return filteredShots
      .filter((s) => s.side_carry != null && s.carry_distance != null && !s.is_outlier)
      .map((s) => ({
        x: s.side_carry!,
        y: adjusted ? (s.carry_distance_adj ?? s.carry_distance!) : s.carry_distance!,
      }))
      .sort((a, b) => a.x - b.x)
  }, [filteredShots, adjusted])

  const ellipses = useMemo(() => computeEllipses(dispersion), [dispersion])

  // Derived: per-effort dispersion groups (replaces Effect C)
  const effortDisp = useMemo(() => {
    const totalBuckets = clubBuckets.length
    const effortKeys = [...new Set(viewShots.map((s) => s.swing_effort).filter((e): e is string => e != null && e !== 'unknown'))]
      .sort((a, b) => parseInt(a) - parseInt(b))
    const groups: EffortDispersion[] = effortKeys.flatMap((effortKey) => {
      const ePts = viewShots
        .filter((s) => s.swing_effort === effortKey && s.side_carry != null && s.carry_distance != null && !s.is_outlier)
        .map((s) => ({
          x: s.side_carry!,
          y: adjusted ? (s.carry_distance_adj ?? s.carry_distance!) : s.carry_distance!,
          club_speed: adjusted ? (s.club_speed_adj ?? s.club_speed) : s.club_speed,
        }))
        .sort((a, b) => a.x - b.x)
      if (ePts.length < 3) return []
      const ell = computeEllipses(ePts)
      const speeds = ePts.map((p) => p.club_speed).filter((v): v is number => v != null)
      const speedMin = speeds.length ? Math.min(...speeds) : null
      const speedMax = speeds.length ? Math.max(...speeds) : null
      const bucketIdx = parseInt(effortKey)
      const label = clubBuckets.find((b) => b.bucket_index === bucketIdx)?.label ?? `Bucket ${effortKey}`
      const color = bucketColor(bucketIdx, totalBuckets || effortKeys.length)
      return [{ effortKey, label, color, pts: ePts, ellipses: ell, speedMin, speedMax }]
    })
    return groups.length >= 2 ? groups : []
  }, [viewShots, clubBuckets, adjusted])

  // Effect E — fetch trend data
  useEffect(() => {
    if (!selectedClub) return
    const disabledParam = disabledClubs.size > 0 ? [...disabledClubs].join(',') : undefined
    const extraParams = {
      ...(disabledParam ? { disabled_clubs: disabledParam } : {}),
      ...(globalDateFrom ? { date_from: globalDateFrom } : {}),
      ...(globalDateTo   ? { date_to:   globalDateTo   } : {}),
    }
    Promise.all([
      api.clubTrend(selectedClub, metric, extraParams),
      api.clubTrend(selectedClub, 'club_speed', extraParams),
    ]).then(([metricTrend, csTrend]) => {
      setTrend(metricTrend)
      setSpeedTrend(csTrend)
    })
    Promise.all([
      api.clubTrend(selectedClub, 'side_carry', extraParams),
      api.clubTrend(selectedClub, 'carry_distance', extraParams),
    ]).then(([side, carry]) => {
      const bySession: Record<string, DispersionPoint> = {}
      for (const pt of side) {
        bySession[pt.session_id] = {
          session_date: pt.session_date,
          session_id: pt.session_id,
          side_std: pt.std,
          carry_std: null,
          shot_count: pt.shot_count,
        }
      }
      for (const pt of carry) {
        if (bySession[pt.session_id]) {
          bySession[pt.session_id].carry_std = pt.std
        } else {
          bySession[pt.session_id] = {
            session_date: pt.session_date,
            session_id: pt.session_id,
            side_std: null,
            carry_std: pt.std,
            shot_count: pt.shot_count,
          }
        }
      }
      setDispTrend(Object.values(bySession).sort((a, b) => a.session_date.localeCompare(b.session_date)))
    })
  }, [selectedClub, metric, disabledClubs, globalDateFrom, globalDateTo])

  const clubName = clubs.find((c) => c.club_type === selectedClub)?.club ?? selectedClub

  // Derived: carry vs club speed regression chart data (replaces IIFE in JSX)
  const speedCarryChart = useMemo(() => {
    const speedCarryPts = viewShots
      .filter((s) => s.club_speed != null && s.carry_distance != null && !s.is_outlier)
      .map((s) => ({
        x: adjusted ? (s.club_speed_adj ?? s.club_speed!) : s.club_speed!,
        y: adjusted ? (s.carry_distance_adj ?? s.carry_distance!) : s.carry_distance!,
      }))
    if (speedCarryPts.length < 3) return null
    const reg = linearRegression(speedCarryPts)
    const xs = speedCarryPts.map((p) => p.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const regLinePts = reg
      ? [{ x: minX, y: reg.slope * minX + reg.intercept }, { x: maxX, y: reg.slope * maxX + reg.intercept }]
      : []
    const r2 = reg ? rSquared(speedCarryPts, reg.slope, reg.intercept) : null
    return { speedCarryPts, reg, regLinePts, r2 }
  }, [viewShots, adjusted])

  const handleMetricChange = useCallback((m: string) => setMetric(m), [])

  return (
    <div>
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <h1 className="text-2xl font-bold text-white">Club Dashboard</h1>
        <AdjustedToggle adjusted={adjusted} onToggle={toggleAdjusted} />
        <select
          value={selectedClub}
          onChange={(e) => { setSelectedClub(e.target.value); setSearchParams({ club: e.target.value }) }}
          className="bg-slate-800 text-white rounded px-3 py-1.5 text-sm border border-slate-600"
        >
          {clubs.map((c) => (
            <option key={c.club_type} value={c.club_type}>
              {c.club} ({c.club_type})
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {/* Global date filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-500 text-xs">Date</span>
          <input
            type="date"
            value={globalDateFrom}
            onChange={(e) => setGlobalDateFrom(e.target.value)}
            className="bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-600"
          />
          <span className="text-slate-500 text-xs">–</span>
          <input
            type="date"
            value={globalDateTo}
            onChange={(e) => setGlobalDateTo(e.target.value)}
            className="bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-600"
          />
          {(globalDateFrom || globalDateTo) && (
            <button
              onClick={() => { setGlobalDateFrom(''); setGlobalDateTo('') }}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {/* Effort toggles (only shown when club has effort data) */}
        {clubBuckets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {clubBuckets.map((b) => {
              const key = String(b.bucket_index)
              const active = enabledEfforts.has(key)
              const color = bucketColor(b.bucket_index, clubBuckets.length)
              return (
                <button
                  key={key}
                  onClick={() => setEnabledEfforts((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })}
                  className="px-2 py-0.5 rounded text-xs font-medium border transition-opacity"
                  style={{
                    borderColor: color,
                    color: active ? color : '#475569',
                    backgroundColor: active ? `${color}22` : 'transparent',
                    opacity: active ? 1 : 0.45,
                  }}
                >
                  {b.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {stats && (
        <>
          <p className="text-slate-400 text-sm mb-4">
            {clubName} · {stats.shot_count} shots
            {sessionContext && <> · {sessionContext.sessionCount} session{sessionContext.sessionCount !== 1 ? 's' : ''}</>}
            {sessionContext?.dateRange && <> · {sessionContext.dateRange}</>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            {carryPercentiles
              ? <CarryRangeCard p10={carryPercentiles.p10} p50={carryPercentiles.p50} p90={carryPercentiles.p90} />
              : <StatCard label="Carry Avg" value={`${n(stats.carry_mean)} yds`} />
            }
            <StatCard label={adjusted ? '~Ball Speed' : 'Ball Speed'} value={`${n(adjusted ? (stats.ball_speed_mean_adj ?? stats.ball_speed_mean) : stats.ball_speed_mean)} mph`} />
            <StatCard label={adjusted ? '~Club Speed' : 'Club Speed'} value={`${n(adjusted ? (stats.club_speed_mean_adj ?? stats.club_speed_mean) : stats.club_speed_mean)} mph`} />
            <StatCard label="Smash Factor" value={n(stats.smash_factor_mean, 2)} />
            <MissCard mean={stats.side_carry_mean} std={stats.side_carry_std} />
            <StatCard label="Spin Rate" value={stats.spin_rate_mean != null ? `${Math.round(stats.spin_rate_mean).toLocaleString()} rpm` : '—'} />
            <StatCard label="Spin Axis" value={stats.spin_axis_mean != null ? `${stats.spin_axis_mean >= 0 ? '+' : ''}${n(stats.spin_axis_mean)}°` : '—'} />
            <StatCard label="Club Path" value={stats.club_path_mean != null ? `${stats.club_path_mean >= 0 ? '+' : ''}${n(stats.club_path_mean)}°` : '—'} />
            <StatCard label="Launch Angle" value={`${n(stats.launch_angle_mean)}°`} />
            <StatCard label="Launch Dir" value={stats.launch_direction_mean != null ? `${stats.launch_direction_mean >= 0 ? '+' : ''}${n(stats.launch_direction_mean)}°` : '—'} />
            <StatCard label="Apex" value={`${n(stats.apex_mean)} yds`} />
            <StatCard label="Attack Angle" value={stats.attack_angle_mean != null ? `${stats.attack_angle_mean >= 0 ? '+' : ''}${n(stats.attack_angle_mean)}°` : '—'} />
          </div>
        </>
      )}

      {/* Recent vs Historical */}
      {(recentStats != null || historicalStats != null) && (
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-white font-semibold">Recent vs Historical</h2>
              <p className="text-slate-500 text-xs mt-0.5">
                Recent: past {recentDays} days ({recentStats?.shot_count ?? 0} shots) · Historical: before that ({historicalStats?.shot_count ?? 0} shots)
              </p>
            </div>
            <select
              value={recentDays}
              onChange={(e) => setRecentDays(Number(e.target.value))}
              className="bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-600"
            >
              <option value={1}>Past 1 day</option>
              <option value={7}>Past 7 days</option>
              <option value={14}>Past 2 weeks</option>
              <option value={30}>Past 30 days</option>
              <option value={90}>Past 3 months</option>
            </select>
          </div>
          {recentStats == null ? (
            <p className="text-slate-500 text-sm">No shots in the recent period — try extending the date range.</p>
          ) : historicalStats == null ? (
            <p className="text-slate-500 text-sm">No historical data before this period yet.</p>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs border-b border-slate-700">
                    <th className="text-left pb-2 font-medium pr-4">Metric</th>
                    <th className="text-right pb-2 font-medium pr-4">Historical</th>
                    <th className="text-right pb-2 font-medium pr-4">Recent</th>
                    <th className="text-right pb-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {comparisonRows.map((row) => {
                    const delta = row.recent != null && row.hist != null ? row.recent - row.hist : null
                    let deltaColor = 'text-slate-400'
                    if (delta != null && row.direction !== 'neutral') {
                      const improved =
                        row.direction === 'higher' ? delta > 0.05
                        : row.direction === 'lower' ? delta < -0.05
                        : Math.abs(row.recent!) < Math.abs(row.hist!)
                      deltaColor = improved ? 'text-green-400' : Math.abs(delta) < 0.05 ? 'text-slate-400' : 'text-red-400'
                    }
                    return (
                      <tr key={row.label}>
                        <td className="py-2.5 text-slate-300 pr-4">{row.label}</td>
                        <td className="py-2.5 text-right text-slate-400 pr-4">
                          {row.hist == null ? '—' : row.valFmt(row.hist)}
                        </td>
                        <td className="py-2.5 text-right text-white font-medium pr-4">
                          {row.recent == null ? '—' : row.valFmt(row.recent)}
                        </td>
                        <td className={`py-2.5 text-right font-medium ${deltaColor}`}>
                          {delta == null ? '—' : row.deltaFmt(delta)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {effortProportions && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                {effortProportions.keys.length >= 2 ? (
                  <>
                    <p className="text-slate-400 text-xs font-medium mb-3">Effort Zone Mix</p>
                    {([
                      { label: 'Historical', data: effortProportions.historical, total: effortProportions.histTotal },
                      { label: 'Recent', data: effortProportions.recent, total: effortProportions.recentTotal },
                    ] as const).map(({ label, data, total }) => (
                      <div key={label} className="flex items-center gap-3 mb-2">
                        <span className="text-slate-400 text-xs w-20 shrink-0 text-right">{label}</span>
                        <div className="flex h-5 rounded overflow-hidden flex-1 bg-slate-800">
                          {data.map((seg) => seg.pct > 0 && (
                            <div
                              key={seg.key}
                              style={{ width: `${seg.pct * 100}%`, backgroundColor: bucketColor(parseInt(seg.key), clubBuckets.length) }}
                              title={`${clubBuckets.find((b) => b.bucket_index === parseInt(seg.key))?.label ?? seg.key}: ${Math.round(seg.pct * 100)}%`}
                            />
                          ))}
                        </div>
                        <span className="text-slate-500 text-xs w-14 shrink-0">{total} shots</span>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 ml-[5.75rem]">
                      {effortProportions.keys.map((k) => (
                        <div key={k} className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: bucketColor(parseInt(k), clubBuckets.length) }} />
                          <span className="text-slate-400 text-xs">{clubBuckets.find((b) => b.bucket_index === parseInt(k))?.label ?? `Bucket ${k}`}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex gap-6 text-xs">
                    <span className="text-slate-500">Historical: <span className="text-slate-300 font-medium">{effortProportions.histTotal} shots</span></span>
                    <span className="text-slate-500">Recent: <span className="text-slate-300 font-medium">{effortProportions.recentTotal} shots</span></span>
                  </div>
                )}
              </div>
            )}
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sessions chart */}
        <SessionsTrendChart
          trendWithBands={trendWithBands}
          speedTrend={speedTrend}
          metric={metric}
          onMetricChange={handleMetricChange}
        />

        {/* Dispersion chart */}
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Shot Dispersion (Carry vs Side)</h2>
            {ellipses && (
              <span className="text-slate-500 text-xs">
                50% · 75% · 95% confidence · {ellipses.inlierCount}/{dispersion.length} shots
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 4, right: 16, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                type="number"
                dataKey="x"
                name="Side Carry"
                label={{ value: 'Side (yds) ← left | right →', position: 'bottom', fill: '#94a3b8', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                domain={['auto', 'auto']}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Carry"
                label={{ value: 'Carry (yds)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6 }}
                formatter={(v, name) => [
                  `${Number(v).toFixed(1)} yds`,
                  name === 'x' ? 'Side' : 'Carry',
                ]}
              />
              <ReferenceLine x={0} stroke="#475569" />
              <Scatter data={dispersion} fill="#4ade80" fillOpacity={0.7} />
              {ellipses && (
                <>
                  <Scatter
                    data={ellipses.ellipses[2].points}
                    line={{ stroke: 'rgba(255,255,255,0.65)', strokeWidth: 1.5, strokeDasharray: '4 2' }}
                    shape={() => null as unknown as React.ReactElement}
                    fill="transparent"
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Scatter
                    data={ellipses.ellipses[1].points}
                    line={{ stroke: 'rgba(255,255,255,0.82)', strokeWidth: 2.5, strokeDasharray: '6 2' }}
                    shape={() => null as unknown as React.ReactElement}
                    fill="transparent"
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Scatter
                    data={ellipses.ellipses[0].points}
                    line={{ stroke: 'rgba(255,255,255,1.0)', strokeWidth: 3 }}
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
      </div>

      {/* Dispersion by swing effort */}
      <EffortDispersionSection effortDisp={effortDisp} />

      {/* Dispersion over time */}
      <DispersionTrendChart dispTrend={dispTrend} />

      {/* Carry vs Club Speed */}
      {speedCarryChart && (
        <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-700">
          <div className="mb-3">
            <h2 className="text-white font-semibold">Carry vs Club Speed</h2>
            {speedCarryChart.reg && (
              <p className="text-slate-500 text-xs mt-0.5">
                {speedCarryChart.reg.slope.toFixed(1)} yds carry per 1 mph club speed
                {speedCarryChart.r2 != null && ` · R² = ${speedCarryChart.r2.toFixed(2)}`} · outliers excluded
              </p>
            )}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 4, right: 16, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                type="number"
                dataKey="x"
                name="Club Speed"
                label={{ value: 'Club Speed (mph)', position: 'bottom', fill: '#94a3b8', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                domain={['auto', 'auto']}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Carry"
                label={{ value: 'Carry (yds)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6 }}
                formatter={(v, name) => [
                  `${Number(v).toFixed(1)}${name === 'Club Speed' ? ' mph' : ' yds'}`,
                  name,
                ]}
              />
              {speedCarryChart.regLinePts.length > 0 && (
                <Scatter
                  data={speedCarryChart.regLinePts}
                  line={{ stroke: '#f59e0b', strokeWidth: 2 }}
                  shape={() => null as unknown as React.ReactElement}
                  fill="transparent"
                  isAnimationActive={false}
                  legendType="none"
                  name="fit"
                />
              )}
              <Scatter data={speedCarryChart.speedCarryPts} fill="#4ade80" fillOpacity={0.7} isAnimationActive={false} name="shots" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stopping power by swing effort */}
      <StoppingPowerTable viewShots={viewShots} clubBuckets={clubBuckets} />

      {/* Shot log */}
      {filteredShots.length > 0 && (
        <div className="mt-6 bg-slate-900 rounded-lg border border-slate-700">
          <button
            onClick={() => setShotLogExpanded((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between border-b border-slate-700 hover:bg-slate-800 transition-colors"
          >
            <div className="text-left">
              <span className="text-white font-semibold">Shot Log</span>
              <span className="text-slate-500 text-xs ml-2">{filteredShots.length} shots · click a column header to sort</span>
            </div>
            <span className="text-slate-400 text-sm">{shotLogExpanded ? '▲' : '▼'}</span>
          </button>
          {shotLogExpanded && <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 text-left">
                <tr>
                  {([
                    { key: 'session_date', label: 'Date' },
                    { key: 'session_id', label: 'Session' },
                    { key: 'shot_number', label: '#' },
                    { key: 'carry_distance', label: adjusted ? '~Carry' : 'Carry' },
                    { key: 'total_distance', label: adjusted ? '~Total' : 'Total' },
                    { key: 'ball_speed', label: adjusted ? '~Ball Spd' : 'Ball Spd' },
                    { key: 'club_speed', label: adjusted ? '~Club Spd' : 'Club Spd' },
                    { key: 'smash_factor', label: 'Smash' },
                    { key: 'launch_angle', label: 'Launch' },
                    { key: 'launch_direction', label: 'Dir.' },
                    { key: 'spin_rate', label: 'Spin' },
                    { key: 'spin_axis', label: 'Axis' },
                    { key: 'side_carry', label: 'Side' },
                    { key: 'apex', label: 'Apex' },
                    { key: 'attack_angle', label: 'Attack' },
                    { key: 'club_path', label: 'Path' },
                    { key: 'swing_effort', label: 'Effort' },
                    { key: 'roll_medium_standard', label: 'Roll·Std (ft)' },
                    { key: 'roll_medium_flyer', label: 'Roll·Fly (ft)' },
                    { key: 'flyer_carry_est', label: 'Fly Carry (yds)' },
                  ] as { key: string; label: string }[]).map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:text-slate-200"
                      onClick={() => toggleShotSort(key)}
                    >
                      {label}<SortIcon active={shotSort.key === key} dir={shotSort.dir} />
                    </th>
                  ))}
                  <th className="px-3 py-2">Outlier</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {sortedShots.map((s, i) => (
                  <tr
                    key={s.shot_id}
                    className={`${
                      s.is_outlier
                        ? 'bg-red-950 text-red-300'
                        : i % 2 === 0
                        ? 'bg-slate-900 text-slate-200'
                        : 'bg-slate-950 text-slate-200'
                    }`}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-400">
                      {s.session_date ? new Date(s.session_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 font-mono text-xs">{s.session_id.slice(0, 8)}</td>
                    <td className="px-3 py-1.5 text-slate-400">{s.shot_number}</td>
                    <td className="px-3 py-1.5 text-right">{n(adjusted ? (s.carry_distance_adj ?? s.carry_distance) : s.carry_distance)} yds</td>
                    <td className="px-3 py-1.5 text-right">{n(adjusted ? (s.total_distance_adj ?? s.total_distance) : s.total_distance)} yds</td>
                    <td className="px-3 py-1.5 text-right">{n(adjusted ? (s.ball_speed_adj ?? s.ball_speed) : s.ball_speed)} mph</td>
                    <td className="px-3 py-1.5 text-right">{n(adjusted ? (s.club_speed_adj ?? s.club_speed) : s.club_speed)} mph</td>
                    <td className="px-3 py-1.5 text-right">{n(s.smash_factor, 2)}</td>
                    <td className="px-3 py-1.5 text-right">{n(s.launch_angle)}°</td>
                    <td className="px-3 py-1.5 text-right">{n(s.launch_direction)}°</td>
                    <td className="px-3 py-1.5 text-right">{s.spin_rate != null ? Math.round(s.spin_rate) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{n(s.spin_axis)}°</td>
                    <td className="px-3 py-1.5 text-right">{n(s.side_carry)} yds</td>
                    <td className="px-3 py-1.5 text-right">{n(s.apex)} yds</td>
                    <td className="px-3 py-1.5 text-right">{n(s.attack_angle)}°</td>
                    <td className="px-3 py-1.5 text-right">{n(s.club_path)}°</td>
                    <td className="px-3 py-1.5 text-slate-400">{s.swing_effort ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      {s.roll_medium_standard != null
                        ? <span className={s.roll_medium_standard < 0 ? 'text-cyan-400' : ''}>
                            {(s.roll_medium_standard >= 0 ? '+' : '') + n(s.roll_medium_standard)}
                          </span>
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-amber-300">
                      {s.roll_medium_flyer != null ? '+' + n(s.roll_medium_flyer) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-amber-300">
                      {n(s.flyer_carry_est)}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => toggleOutlier(s)}
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          s.is_outlier
                            ? 'bg-red-800 text-red-200 hover:bg-red-700'
                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >
                        {s.is_outlier ? 'Outlier' : 'Flag'}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      {editing === s.shot_id ? (
                        <div className="flex gap-1">
                          <input
                            autoFocus
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            className="bg-slate-700 text-white rounded px-2 py-0.5 text-xs w-32"
                            placeholder="reason..."
                          />
                          <button onClick={() => saveNote(s)} className="text-green-400 text-xs">✓</button>
                          <button onClick={() => setEditing(null)} className="text-slate-400 text-xs">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditing(s.shot_id); setNoteText(s.outlier_note ?? '') }}
                          className="text-slate-500 hover:text-slate-300 text-xs"
                        >
                          {s.outlier_note ?? '+'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}
      {/* Note: trend chart data comes from the API in raw space; correcting it would require API changes */}
      {adjusted && <AdjustedFootnote elevation={settings.elevation_ft} temperature={settings.temperature_f} />}
    </div>
  )
}
