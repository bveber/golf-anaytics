const BASE = '/api'

export interface Session {
  session_id: string
  session_date: string | null
  session_type: string | null
  notes: string | null
  scraped_at: string
  shot_count: number | null
}

export interface Shot {
  shot_id: string
  session_id: string
  session_date: string | null
  shot_number: number
  club: string | null
  club_type: string | null
  target_distance: number | null
  is_outlier: boolean
  outlier_note: string | null
  ball_speed: number | null
  launch_angle: number | null
  launch_direction: number | null
  spin_rate: number | null
  spin_axis: number | null
  smash_factor: number | null
  carry_distance: number | null
  total_distance: number | null
  side_carry: number | null
  apex: number | null
  descent_angle: number | null
  club_speed: number | null
  attack_angle: number | null
  club_path: number | null
  swing_effort: string | null
  roll_medium_standard: number | null
  roll_medium_flyer: number | null
  flyer_carry_est: number | null
  ball_speed_adj: number | null
  club_speed_adj: number | null
  carry_distance_adj: number | null
  total_distance_adj: number | null
  smash_factor_adj: number | null
}

export interface ClubStats {
  club: string
  club_type: string | null
  shot_count: number
  carry_mean: number | null
  carry_std: number | null
  total_mean: number | null
  total_std: number | null
  ball_speed_mean: number | null
  spin_rate_mean: number | null
  smash_factor_mean: number | null
  side_carry_mean: number | null
  side_carry_std: number | null
  launch_angle_mean: number | null
  club_speed_mean: number | null
  spin_axis_mean: number | null
  club_path_mean: number | null
  attack_angle_mean: number | null
  launch_direction_mean: number | null
  apex_mean: number | null
  carry_mean_adj: number | null
  total_mean_adj: number | null
  ball_speed_mean_adj: number | null
  club_speed_mean_adj: number | null
}

export interface UserSettings {
  elevation_ft: number
  temperature_f: number
}

export interface TrendPoint {
  session_date: string
  session_id: string
  mean: number | null
  std: number | null
  shot_count: number
}

export interface ClubOption {
  club: string
  club_type: string
}

export interface SwingEffortBucket {
  bucket_index: number
  lower_bound: number
  upper_bound: number | null
  label: string
}

export interface SwingEffortThreshold {
  club_type: string
  buckets: SwingEffortBucket[]
  shot_count: number
  updated_at: string
}

export interface HistogramBin {
  lo: number
  hi: number
  count: number
  carry: number | null
  apex: number | null
  side_carry: number | null
  total_distance: number | null
}

export interface SpeedHistogram {
  bins: HistogramBin[]
  thresholds: SwingEffortBucket[] | null
  total: number
}

export interface MatrixBucket {
  n: number
  label: string | null
  carry_mean: number | null
  carry_std: number | null
  total_mean: number | null
  side_carry_std: number | null
  apex_mean: number | null
  speed_mean: number | null
  ball_speed_mean: number | null
  spin_rate_mean: number | null
  smash_factor_mean: number | null
  attack_angle_mean: number | null
}

export interface MatrixRow {
  club_type: string
  club: string
  buckets: Record<string, MatrixBucket>
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json()
}

export interface GtRound {
  id: number
  date: string
  is_practice: boolean
  total_holes: number
  notes: string | null
  course_name: string
  course_city: string
  course_state: string
  tee_name: string
  rating: number
  slope: number
  total_score: number
  total_par: number
  total_putts: number
  sg_off_tee: number | null
  sg_approach: number | null
  sg_around_green: number | null
  sg_putting: number | null
  strokes_gained: number | null
}

export interface GtHoleStat {
  hole_number: number
  par: number
  handicap_index: number | null
  hole_stat_id: number
  score: number
  is_scored: boolean
  putts: number
  chips: number
  sand_shots: number
  gir: boolean
  tee_shot_distance: number | null
  tee_outcome: string | null
  tee_mishit: boolean
  tee_in_trouble: boolean
  tee_club_id: number | null
  adjusted_yardage: number | null
  tee_dispersion_left: number | null
  tee_dispersion_right: number | null
  tee_dispersion_long: number | null
  tee_dispersion_short: number | null
  sg_off_tee: number | null
  sg_approach: number | null
  sg_around_green: number | null
  sg_putting: number | null
  strokes_gained: number | null
  penalties: number
}

export interface GtShot {
  club_id: number
  distance_to_pin: number | null
  distance_traveled: number | null
  lie: string | null
  outcome: string | null
  is_mishit: boolean
  strokes_gained: number | null
  dispersion_left: number | null
  dispersion_right: number | null
  dispersion_long: number | null
  dispersion_short: number | null
  round_date: string | null
  course_name: string | null
  hole_number: number | null
}

export interface GtRoundDetail {
  round: Omit<GtRound, 'total_score' | 'total_par' | 'total_putts' | 'sg_off_tee' | 'sg_approach' | 'sg_around_green' | 'sg_putting' | 'strokes_gained'>
  holes: GtHoleStat[]
}

export const api = {
  sessions: () => get<Session[]>('/sessions/'),
  session: (id: string) => get<Session>(`/sessions/${id}`),
  shotsForSession: (id: string) => get<Shot[]>(`/shots/session/${id}`),
  shotsByClub: (clubType: string, params?: Record<string, string>) =>
    get<Shot[]>(`/shots/club/${clubType}`, params),
  clubStats: (params?: Record<string, string>) => get<ClubStats[]>('/stats/clubs', params),
  sessionClubStats: (sessionId: string) => get<ClubStats[]>('/stats/clubs', { session_id: sessionId }),
  clubTrend: (clubType: string, metric: string, params?: Record<string, string>) =>
    get<TrendPoint[]>(`/stats/club/${clubType}/trend`, { metric, ...params }),
  clubList: () => get<ClubOption[]>('/stats/clubs/list'),
  gtRounds: () => get<GtRound[]>('/golf-tracker/rounds'),
  gtRound: (id: number) => get<GtRoundDetail>(`/golf-tracker/rounds/${id}`),
  gtShots: (clubId?: number) => get<GtShot[]>('/golf-tracker/shots', clubId != null ? { club_id: String(clubId) } : undefined),
  gtIngest: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/golf-tracker/ingest`, { method: 'POST', body: form }).then((r) => r.json())
  },
  swingEffortThresholds: (disabledClubs?: string) =>
    get<SwingEffortThreshold[]>('/swing-effort/thresholds', disabledClubs ? { disabled_clubs: disabledClubs } : undefined),
  swingEffortCalibrate: () =>
    fetch(`${BASE}/swing-effort/calibrate`, { method: 'POST' }).then((r) => r.json()),
  swingEffortCalibrateOne: (clubType: string) =>
    fetch(`${BASE}/swing-effort/calibrate?club_type=${encodeURIComponent(clubType)}`, { method: 'POST' }).then((r) => r.json()),
  updateSwingEffortThresholds: (clubType: string, boundaries: number[]) =>
    fetch(`${BASE}/swing-effort/thresholds/${encodeURIComponent(clubType)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boundaries }),
    }).then((r) => r.json()),
  speedHistogram: (clubType: string, disabledClubs?: string) =>
    get<SpeedHistogram>(`/swing-effort/histogram/${clubType}`, disabledClubs ? { disabled_clubs: disabledClubs } : undefined),
  wedgeMatrix: (params?: Record<string, string>) => get<MatrixRow[]>('/swing-effort/matrix', params),
  getSettings: () => get<UserSettings>('/settings'),
  updateSettings: (body: Partial<UserSettings>) =>
    fetch(`${BASE}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<UserSettings>),
  updateOutlier: (shotId: string, isOutlier: boolean, note?: string) =>
    fetch(`${BASE}/shots/${encodeURIComponent(shotId)}/outlier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_outlier: isOutlier, outlier_note: note ?? null }),
    }).then((r) => r.json()),
}
