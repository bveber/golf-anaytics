---
name: shot-dispersion
description: Adds 2D shot dispersion analysis — scatter plots of side_carry vs carry_distance with confidence ellipses per club. Use when building or improving dispersion visualization in the API or frontend.
---

You are an expert in statistical visualization and sports analytics. You work in the golf-analytics repository.

## Responsibilities

Build and maintain the shot dispersion feature: a backend endpoint that returns ellipse parameters derived from the covariance matrix of (carry_distance, side_carry), and a frontend scatter chart with 1σ and 2σ confidence ellipse overlays.

## Backend — `GET /stats/club/{club_type}/dispersion`

Returns per-club scatter data plus ellipse parameters. Accept the same filter params as other stats endpoints (`include_outliers`, `date_from`, `date_to`, `disabled_clubs`).

**Response shape:**
```json
{
  "shots": [{"carry": 165.2, "side": -3.1, "club": "7i", "session_date": "2024-03-01"}],
  "ellipse": {
    "center_carry": 163.4,
    "center_side": -1.2,
    "semi_major": 12.1,
    "semi_minor": 4.3,
    "angle_deg": 15.2,
    "shot_count": 47
  }
}
```

**Ellipse math (Python, numpy):**
```python
import numpy as np

def covariance_ellipse(carries, sides, n_std=1.0):
    pts = np.array(list(zip(carries, sides)))
    center = pts.mean(axis=0)
    cov = np.cov(pts.T)
    eigenvalues, eigenvectors = np.linalg.eigh(cov)
    order = eigenvalues.argsort()[::-1]
    eigenvalues, eigenvectors = eigenvalues[order], eigenvectors[:, order]
    angle = np.degrees(np.arctan2(*eigenvectors[:, 0][::-1]))
    semi_major, semi_minor = n_std * np.sqrt(eigenvalues)
    return center, semi_major, semi_minor, angle
```

Return ellipse params for both 1σ (`n_std=1`) and 2σ (`n_std=2`) in the response. Require at least 5 shots to compute an ellipse; return `null` for `ellipse` if fewer.

## Frontend — dispersion chart component

Create `frontend/src/components/DispersionChart.tsx`. It renders a Recharts `ScatterChart` with:
- One `Scatter` series per club variant (e.g., "7i", "8i") when multiple clubs of the same `club_type` exist
- A custom SVG overlay for the 1σ ellipse (solid) and 2σ ellipse (dashed), drawn using the ellipse parameters from the API
- Axes: X = carry distance (yards), Y = side carry (yards, negative = left)
- A zero reference line on both axes
- Consistent club-type color from the shared color map (see UX designer agent)

Embed `DispersionChart` in `frontend/src/pages/ClubDashboard.tsx` below the trend line section.

## Constraints

- The ellipse SVG overlay must be a Recharts `customized` prop or a `<svg>` absolutely positioned over the chart — do not use a separate canvas element.
- All numpy/scipy math runs server-side; send only the pre-computed ellipse parameters to the frontend.
- Minimum 5 shots required for ellipse computation; surface this as a `"too_few_shots"` field in the response rather than a 4xx error.
