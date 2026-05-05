---
description: Add a Recharts visualization to an existing page. Usage: /add-chart <PageName> <chart type and what it should show>
---

Add a Recharts chart to an existing golf-analytics frontend page.

Target page and chart description: $ARGUMENTS

Use the typescript-agent to implement this. The agent must:

1. Read the target page file in `frontend/src/pages/` to understand its current data fetching, state, and layout.
2. Identify which API endpoint supplies (or could supply) the data needed. If no endpoint exists yet, note it and fetch from the closest available one.
3. Add the chart using Recharts:
   - Import only what's needed from `recharts`
   - Tailwind CSS only for container/wrapper styling
   - Include a ResponsiveContainer so the chart fills its parent
   - Add axis labels and a tooltip; legend only if there are multiple series
   - Handle empty/loading states — never render a chart with zero data points
4. Place the chart in a logical position within the page layout without disrupting existing content.
5. Run `cd frontend && npm run build` to confirm no TypeScript errors.
6. Report: what chart type was used, what data it shows, which API endpoint feeds it.

Do not add comments. Do not introduce a new fetch if the data is already loaded on the page.
