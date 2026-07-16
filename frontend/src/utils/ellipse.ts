// ── Chi-squared scale factors for each confidence level ───────────────────
// chi²(2, 0.50) ≈ 1.386  →  50% confidence ellipse
// chi²(2, 0.75) ≈ 2.773  →  75% confidence ellipse
// chi²(2, 0.95) ≈ 5.991  →  95% confidence ellipse
const CHI2_LEVELS = [
  { level: 0.50 as const, chiSq: 1.386 },
  { level: 0.75 as const, chiSq: 2.773 },
  { level: 0.95 as const, chiSq: 5.991 },
]

// Mahalanobis outlier-filter threshold: chi²(2, 0.90) ≈ 4.605
const CHI2_OUTLIER_THRESHOLD = 4.605

// Number of perimeter points generated per ellipse ring
const ELLIPSE_POINT_COUNT = 72

export interface EllipseResult {
  cx: number
  cy: number
  ellipses: Array<{
    level: 0.50 | 0.75 | 0.95
    points: Array<{ x: number; y: number }>
  }>
  inlierCount: number
  totalCount: number
}

/**
 * Compute three nested confidence ellipses (50%, 75%, 95%) for a set of
 * 2-D shot points via PCA of the covariance matrix.
 *
 * Steps:
 *  1. Filter nulls/undefined (caller should pass clean points, but guard anyway)
 *  2. Mahalanobis outlier filter at chi²(2, 0.90) = 4.605
 *  3. Recompute covariance on inliers
 *  4. Eigendecompose covariance matrix
 *  5. For each chi² scale factor, generate 72 perimeter points
 *
 * Returns null if fewer than 3 inlier shots or the covariance is degenerate.
 */
export function computeEllipses(
  shots: Array<{ x: number; y: number }>,
): EllipseResult | null {
  // Guard: remove any non-finite points
  const pts = shots.filter(
    (p) => p != null && isFinite(p.x) && isFinite(p.y),
  )
  const totalCount = pts.length

  // ── Step 1: compute initial mean for outlier filter ──────────────────────
  if (pts.length < 3) return null

  const initialN = pts.length
  const initialMx = pts.reduce((s, p) => s + p.x, 0) / initialN
  const initialMy = pts.reduce((s, p) => s + p.y, 0) / initialN

  let iSxx = 0, iSyy = 0, iSxy = 0
  for (const p of pts) {
    iSxx += (p.x - initialMx) ** 2
    iSyy += (p.y - initialMy) ** 2
    iSxy += (p.x - initialMx) * (p.y - initialMy)
  }
  iSxx /= initialN - 1
  iSyy /= initialN - 1
  iSxy /= initialN - 1

  const initialDet = iSxx * iSyy - iSxy * iSxy

  // ── Step 2: Mahalanobis outlier filter ───────────────────────────────────
  let inliers: Array<{ x: number; y: number }>
  if (initialN < 4 || initialDet < 1e-10) {
    inliers = pts
  } else {
    inliers = pts.filter((p) => {
      const dx = p.x - initialMx
      const dy = p.y - initialMy
      const d2 =
        (iSyy * dx * dx - 2 * iSxy * dx * dy + iSxx * dy * dy) / initialDet
      return d2 <= CHI2_OUTLIER_THRESHOLD
    })
  }

  if (inliers.length < 3) return null

  // ── Step 3: recompute covariance on inliers ──────────────────────────────
  const n = inliers.length
  const cx = inliers.reduce((s, p) => s + p.x, 0) / n
  const cy = inliers.reduce((s, p) => s + p.y, 0) / n

  let sxx = 0, syy = 0, sxy = 0
  for (const p of inliers) {
    sxx += (p.x - cx) ** 2
    syy += (p.y - cy) ** 2
    sxy += (p.x - cx) * (p.y - cy)
  }
  sxx /= n - 1
  syy /= n - 1
  sxy /= n - 1

  const det = sxx * syy - sxy * sxy
  if (det < 1e-10) return null

  // ── Step 4: eigendecompose [[sxx, sxy],[sxy, syy]] ───────────────────────
  const trace = sxx + syy
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
  const lambda1 = trace / 2 + disc  // major-axis variance
  const lambda2 = trace / 2 - disc  // minor-axis variance

  // Angle of major eigenvector (radians, then degrees)
  const angleDeg = (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI)
  const angleRad = (angleDeg * Math.PI) / 180

  const sqrtL1 = Math.sqrt(Math.max(0, lambda1))
  const sqrtL2 = Math.sqrt(Math.max(0, lambda2))

  // ── Step 5: generate perimeter points for each confidence level ──────────
  const ellipses = CHI2_LEVELS.map(({ level, chiSq }) => {
    const scale = Math.sqrt(chiSq)
    const rx = sqrtL1 * scale
    const ry = sqrtL2 * scale
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= ELLIPSE_POINT_COUNT; i++) {
      const t = (i / ELLIPSE_POINT_COUNT) * 2 * Math.PI
      const ex = rx * Math.cos(t)
      const ey = ry * Math.sin(t)
      points.push({
        x: cx + ex * Math.cos(angleRad) - ey * Math.sin(angleRad),
        y: cy + ex * Math.sin(angleRad) + ey * Math.cos(angleRad),
      })
    }
    return { level, points }
  })

  return { cx, cy, ellipses, inlierCount: n, totalCount }
}
