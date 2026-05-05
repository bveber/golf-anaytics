import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { api } from '../api'
import type { GtRoundDetail } from '../api'

function sgColor(v: number | null) {
  if (v == null) return 'text-slate-500'
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
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function scoreBadge(score: number, par: number) {
  const diff = score - par
  const styles: Record<string, string> = {
    '-2': 'bg-yellow-500 text-black',
    '-1': 'bg-red-700 text-white',
    '0': 'bg-slate-600 text-white',
    '1': 'bg-blue-900 text-blue-200',
    '2': 'bg-slate-700 text-slate-300',
  }
  const clamp = String(Math.max(-2, Math.min(2, diff)))
  const cls = styles[clamp] ?? 'bg-slate-700 text-slate-400'
  const label = diff === -2 ? 'Eagle' : diff === -1 ? 'Birdie' : diff === 0 ? 'Par'
    : diff === 1 ? 'Bogey' : diff === 2 ? 'Dbl' : `+${diff}`
  return { cls, label }
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className="text-white text-xl font-bold">{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function SgBar({ value, max = 1.5 }: { value: number | null; max?: number }) {
  if (value == null) return <span className="text-slate-600 text-xs">—</span>
  const pct = Math.min(Math.abs(value) / max, 1)
  const isPos = value >= 0
  return (
    <div className="flex items-center gap-1.5">
      {isPos ? (
        <>
          <div className="w-16 flex justify-end">
            <div className="bg-transparent w-full" />
          </div>
          <div className="w-0.5 h-3 bg-slate-600" />
          <div style={{ width: `${pct * 64}px` }} className="h-2 rounded-r bg-green-500 min-w-0.5" />
        </>
      ) : (
        <>
          <div style={{ width: `${pct * 64}px` }} className="h-2 rounded-l bg-red-500 min-w-0.5 ml-auto" />
          <div className="w-0.5 h-3 bg-slate-600" />
          <div className="w-16" />
        </>
      )}
      <span className={`text-xs w-12 text-right ${sgColor(value)}`}>{sgFmt(value)}</span>
    </div>
  )
}

export default function RoundDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<GtRoundDetail | null>(null)

  useEffect(() => {
    if (!id) return
    api.gtRound(Number(id)).then(setDetail).catch(() => navigate('/rounds'))
  }, [id])

  if (!detail) return null

  const { round, holes } = detail
  const scored = holes.filter((h) => h.is_scored)
  const totalScore = scored.reduce((s, h) => s + h.score, 0)
  const totalPar = scored.reduce((s, h) => s + h.par, 0)
  const scoreDiff = totalScore - totalPar
  const totalSgOffTee = holes.reduce((s, h) => s + (h.sg_off_tee ?? 0), 0)
  const totalSgApp = holes.reduce((s, h) => s + (h.sg_approach ?? 0), 0)
  const totalSgAG = holes.reduce((s, h) => s + (h.sg_around_green ?? 0), 0)
  const totalSgPutt = holes.reduce((s, h) => s + (h.sg_putting ?? 0), 0)
  const totalSg = holes.reduce((s, h) => s + (h.strokes_gained ?? 0), 0)
  const totalPutts = scored.reduce((s, h) => s + (h.putts ?? 0), 0)
  const girCount = scored.filter((h) => h.gir).length

  return (
    <div>
      <button onClick={() => navigate('/rounds')} className="text-slate-400 hover:text-white text-sm mb-4">
        ← Back
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">
          {round.course_name}
          {round.is_practice && <span className="ml-3 text-sm font-normal text-slate-500 italic">practice round</span>}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {fmtDate(round.date)} · {round.tee_name} tees (Rating {round.rating} / Slope {round.slope}) · {round.total_holes} holes
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <SummaryCard
          label="Score"
          value={`${totalScore}`}
          sub={`${scoreDiff >= 0 ? '+' : ''}${scoreDiff} (Par ${totalPar})`}
        />
        <SummaryCard label="Putts" value={`${totalPutts}`} sub={`${(totalPutts / scored.length).toFixed(1)}/hole`} />
        <SummaryCard label="GIR" value={`${girCount}/${scored.length}`} sub={`${Math.round(girCount / scored.length * 100)}%`} />
        <SummaryCard label="SG: Approach" value={sgFmt(totalSgApp)} sub="vs field" />
        <SummaryCard label="SG: Putting" value={sgFmt(totalSgPutt)} sub="vs field" />
        <SummaryCard label="SG: Total" value={sgFmt(totalSg)} sub="vs field" />
      </div>

      {/* SG breakdown bar chart */}
      <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
        <h2 className="text-white font-semibold mb-4 text-sm">Strokes Gained Breakdown</h2>
        <div className="space-y-3">
          {[
            { label: 'Off Tee', value: totalSgOffTee },
            { label: 'Approach', value: totalSgApp },
            { label: 'Around Green', value: totalSgAG },
            { label: 'Putting', value: totalSgPutt },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-4">
              <span className="text-slate-400 text-xs w-28 text-right">{label}</span>
              <SgBar value={value} max={2} />
            </div>
          ))}
        </div>
      </div>

      {/* Tee shot dispersion scatter */}
      {(() => {
        const dispPts = holes
          .filter((h) => h.is_scored && (h.tee_dispersion_left != null || h.tee_dispersion_right != null))
          .map((h) => ({
            hole: h.hole_number,
            x: (h.tee_dispersion_right ?? 0) - (h.tee_dispersion_left ?? 0),
            y: (h.tee_dispersion_long ?? 0) - (h.tee_dispersion_short ?? 0),
            outcome: h.tee_outcome,
          }))
        if (dispPts.length === 0) return null
        return (
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
            <h2 className="text-white font-semibold mb-1 text-sm">Tee Shot Dispersion</h2>
            <p className="text-slate-500 text-xs mb-4">Each dot is one hole. Target is center (0, 0). Right/left = offline; long/short = distance.</p>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  type="number" dataKey="x" name="Offline"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  label={{ value: '← Left  |  Right →', position: 'bottom', fill: '#94a3b8', fontSize: 11 }}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  type="number" dataKey="y" name="Distance"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  label={{ value: 'Short ↓ | Long ↑', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6 }}
                  formatter={(v, name) => [`${Number(v) >= 0 ? '+' : ''}${Number(v)} yds`, name]}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-slate-800 border border-slate-600 rounded p-2 text-xs">
                        <div className="text-white font-medium mb-1">Hole {d.hole}</div>
                        <div className="text-slate-300">{d.outcome?.replace(/_/g, ' ').toLowerCase() ?? '—'}</div>
                        <div className="text-slate-400">Offline: {d.x >= 0 ? `${d.x} R` : `${-d.x} L`}</div>
                        <div className="text-slate-400">Dist: {d.y >= 0 ? `+${d.y} long` : `${-d.y} short`}</div>
                      </div>
                    )
                  }}
                />
                <ReferenceLine x={0} stroke="#475569" />
                <ReferenceLine y={0} stroke="#475569" />
                <Scatter
                  data={dispPts}
                  fill="#4ade80"
                  fillOpacity={0.75}
                  shape={(props: any) => {
                    const { cx, cy, payload } = props
                    const color = payload.outcome === 'ON_TARGET' ? '#4ade80'
                      : payload.outcome?.includes('MISS') ? '#f87171' : '#facc15'
                    return <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.8} />
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex gap-4 text-xs text-slate-500 mt-2 justify-center">
              <span><span className="text-green-400">●</span> On target</span>
              <span><span className="text-red-400">●</span> Miss left/right</span>
              <span><span className="text-yellow-400">●</span> Short/long</span>
            </div>
          </div>
        )
      })()}

      {/* Hole-by-hole table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-xs">
          <thead className="bg-slate-800 text-slate-400 text-left">
            <tr>
              <th className="px-3 py-2">Hole</th>
              <th className="px-3 py-2 text-center">Par</th>
              <th className="px-3 py-2 text-center">Hcp</th>
              <th className="px-3 py-2 text-center">Score</th>
              <th className="px-3 py-2 text-center">Putts</th>
              <th className="px-3 py-2 text-center">GIR</th>
              <th className="px-3 py-2 text-center">Sand</th>
              <th className="px-3 py-2 text-right">Tee Dist</th>
              <th className="px-3 py-2">Tee Result</th>
              <th className="px-3 py-2 text-right">SG: Tee</th>
              <th className="px-3 py-2 text-right">SG: App</th>
              <th className="px-3 py-2 text-right">SG: AG</th>
              <th className="px-3 py-2 text-right">SG: Putt</th>
              <th className="px-3 py-2 text-right">SG: Total</th>
            </tr>
          </thead>
          <tbody>
            {holes.map((h, i) => {
              const { cls: badgeCls, label: badgeLabel } = scoreBadge(h.score, h.par)
              const rowBase = i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'
              const rowCls = h.is_scored ? rowBase : `${rowBase} opacity-50`
              return (
                <tr key={h.hole_number} className={`${rowCls} text-slate-200`}>
                  <td className="px-3 py-1.5 font-medium text-white">{h.hole_number}</td>
                  <td className="px-3 py-1.5 text-center text-slate-400">{h.par}</td>
                  <td className="px-3 py-1.5 text-center text-slate-500">{h.handicap_index ?? '—'}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badgeCls}`}>
                      {h.score} <span className="opacity-70 text-xs">{badgeLabel}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">{h.putts}</td>
                  <td className="px-3 py-1.5 text-center">
                    {h.gir ? <span className="text-green-400">✓</span> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center text-slate-400">{h.sand_shots || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-slate-300">
                    {h.tee_shot_distance != null ? `${h.tee_shot_distance} yds` : '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    {h.tee_outcome ? (
                      <span className={`text-xs ${
                        h.tee_outcome === 'ON_TARGET' ? 'text-green-400' :
                        h.tee_in_trouble ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        {h.tee_outcome.replace('_', ' ').toLowerCase()}
                        {h.tee_mishit && ' ⚡'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={`px-3 py-1.5 text-right ${sgColor(h.sg_off_tee)}`}>{sgFmt(h.sg_off_tee)}</td>
                  <td className={`px-3 py-1.5 text-right ${sgColor(h.sg_approach)}`}>{sgFmt(h.sg_approach)}</td>
                  <td className={`px-3 py-1.5 text-right ${sgColor(h.sg_around_green)}`}>{sgFmt(h.sg_around_green)}</td>
                  <td className={`px-3 py-1.5 text-right ${sgColor(h.sg_putting)}`}>{sgFmt(h.sg_putting)}</td>
                  <td className={`px-3 py-1.5 text-right font-medium ${sgColor(h.strokes_gained)}`}>{sgFmt(h.strokes_gained)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-800 text-slate-300 font-medium text-xs">
            <tr>
              <td className="px-3 py-2 text-white">Total</td>
              <td className="px-3 py-2 text-center">{totalPar}</td>
              <td colSpan={2} className="px-3 py-2 text-center">
                <span className={scoreDiff === 0 ? 'text-slate-200' : scoreDiff < 0 ? 'text-green-400' : 'text-red-400'}>
                  {totalScore} ({scoreDiff >= 0 ? '+' : ''}{scoreDiff})
                </span>
              </td>
              <td className="px-3 py-2 text-center">{totalPutts}</td>
              <td className="px-3 py-2 text-center">{girCount}</td>
              <td colSpan={3} />
              <td className={`px-3 py-2 text-right ${sgColor(totalSgOffTee)}`}>{sgFmt(totalSgOffTee)}</td>
              <td className={`px-3 py-2 text-right ${sgColor(totalSgApp)}`}>{sgFmt(totalSgApp)}</td>
              <td className={`px-3 py-2 text-right ${sgColor(totalSgAG)}`}>{sgFmt(totalSgAG)}</td>
              <td className={`px-3 py-2 text-right ${sgColor(totalSgPutt)}`}>{sgFmt(totalSgPutt)}</td>
              <td className={`px-3 py-2 text-right ${sgColor(totalSg)}`}>{sgFmt(totalSg)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
