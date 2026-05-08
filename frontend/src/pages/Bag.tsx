import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ClubStats, ClubOption, UserSettings } from '../api'
import { useBag, bagKey } from '../BagContext'
import { useAdjusted } from '../hooks/useAdjusted'
import AdjustedToggle from '../components/AdjustedToggle'
import AdjustedFootnote from '../components/AdjustedFootnote'

function n(v: number | null | undefined, dec = 1) {
  return v == null ? '—' : v.toFixed(dec)
}

const CLUB_ORDER = ['d', '3w', '5w', '7w', '2h', '3h', '4h', '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'pw', 'gw', 'sw', 'lw']

function clubSortKey(clubType: string): number {
  const i = CLUB_ORDER.indexOf(clubType)
  return i === -1 ? 999 : i
}

interface BagRow {
  club_type: string
  club: string
  stats: ClubStats | null  // null = exists in shots but no full-effort data yet
}

export default function Bag() {
  const [rows, setRows] = useState<BagRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const { disabledClubs, toggleClub } = useBag()
  const [settings, setSettings] = useState<UserSettings>({ elevation_ft: 900, temperature_f: 70 })
  const { adjusted, toggleAdjusted } = useAdjusted()

  useEffect(() => {
    api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    Promise.all([
      api.clubList(),
      api.clubStats({ effort: 'full' }),
    ]).then(([allClubs, effortStats]: [ClubOption[], ClubStats[]]) => {
      const statsByType = new Map(effortStats.map((s) => [s.club_type, s]))

      // Use clubList as the source of truth — every club that has ever appeared in a session
      const merged: BagRow[] = allClubs.map((c) => ({
        club_type: c.club_type,
        club: c.club,
        stats: statsByType.get(c.club_type) ?? null,
      }))

      merged.sort((a, b) => clubSortKey(a.club_type) - clubSortKey(b.club_type))
      setRows(merged)
    }).catch(() => setError('Failed to load club data — is the API running?'))
  }, [])

  if (error) return <div className="text-red-400 text-sm mt-8 text-center">{error}</div>

  if (rows.length === 0) return (
    <div className="text-center py-20 text-slate-500">
      <p className="text-lg mb-2">No club data yet</p>
      <p className="text-sm">Upload Rapsodo session data on the Sessions tab first.</p>
    </div>
  )

  const activeCount = rows.filter((r) => !disabledClubs.has(bagKey(r.club_type, r.club))).length

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-white">My Bag</h1>
        <AdjustedToggle adjusted={adjusted} onToggle={toggleAdjusted} />
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Full effort averages per club (highest speed bucket). All clubs found in your sessions are listed automatically.
        Toggle clubs off to hide them across all pages.
        {disabledClubs.size > 0 && (
          <span className="ml-2 text-yellow-400">{disabledClubs.size} club{disabledClubs.size > 1 ? 's' : ''} inactive</span>
        )}
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3">Club</th>
              <th className="px-4 py-3 text-right">Carry</th>
              <th className="px-4 py-3 text-right">±Std</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">{adjusted ? '~Ball Spd' : 'Ball Spd'}</th>
              <th className="px-4 py-3 text-right">{adjusted ? '~Club Spd' : 'Club Spd'}</th>
              <th className="px-4 py-3 text-right">Smash</th>
              <th className="px-4 py-3 text-right">Launch</th>
              <th className="px-4 py-3 text-right">Spin</th>
              <th className="px-4 py-3 text-right">Side ±</th>
              <th className="px-4 py-3 text-right">Shots</th>
              <th className="px-4 py-3 text-center">In Bag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ct = r.club_type
              const active = !disabledClubs.has(bagKey(ct, r.club))
              const s = r.stats
              const needsCalibration = s == null
              return (
                <tr
                  key={r.club}
                  className={[
                    i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950',
                    active ? 'text-slate-200' : 'text-slate-600 opacity-60',
                  ].join(' ')}
                >
                  <td className="px-4 py-2.5">
                    <span className={`font-medium ${active ? 'text-white' : 'text-slate-500'}`}>{ct}</span>
                    <span className={`ml-2 text-xs ${active ? 'text-slate-400' : 'text-slate-600'}`}>{r.club}</span>
                    {needsCalibration && (
                      <span className="ml-2 text-xs text-amber-500">needs calibration</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">{n(s?.carry_mean)} yds</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">±{n(s?.carry_std)}</td>
                  <td className="px-4 py-2.5 text-right">{n(s?.total_mean)} yds</td>
                  <td className="px-4 py-2.5 text-right">{n(adjusted ? (s?.ball_speed_mean_adj ?? s?.ball_speed_mean) : s?.ball_speed_mean)} mph</td>
                  <td className="px-4 py-2.5 text-right">{n(adjusted ? (s?.club_speed_mean_adj ?? s?.club_speed_mean) : s?.club_speed_mean)} mph</td>
                  <td className="px-4 py-2.5 text-right">{n(s?.smash_factor_mean, 2)}</td>
                  <td className="px-4 py-2.5 text-right">{n(s?.launch_angle_mean)}°</td>
                  <td className="px-4 py-2.5 text-right">{n(s?.spin_rate_mean, 0)} rpm</td>
                  <td className="px-4 py-2.5 text-right">±{n(s?.side_carry_std)} yds</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{s?.shot_count ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => toggleClub(ct, r.club)}
                      className={[
                        'w-10 h-5 rounded-full transition-colors relative',
                        active ? 'bg-green-600' : 'bg-slate-700',
                      ].join(' ')}
                      title={active ? 'Click to remove from bag' : 'Click to add to bag'}
                    >
                      <span
                        className={[
                          'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                          active ? 'translate-x-5' : 'translate-x-0.5',
                        ].join(' ')}
                      />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-slate-900 border-t border-slate-700 text-xs text-slate-500">
          {activeCount} of {rows.length} clubs active — inactive clubs are hidden on all other pages
        </div>
      </div>
      {adjusted && <AdjustedFootnote elevation={settings.elevation_ft} temperature={settings.temperature_f} />}
    </div>
  )
}
