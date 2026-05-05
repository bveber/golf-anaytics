---
description: Scaffold a new React page in frontend/src/pages/ and wire up routing. Usage: /new-page <PageName> [description of what it shows]
---

Scaffold a new React page for the golf-analytics frontend.

Page name and purpose: $ARGUMENTS

Use the typescript-agent to implement this. The agent must:

1. Read frontend/src/App.tsx to understand the route map and BagContext usage. Read one existing page (e.g. ClubDashboard.tsx) as a style reference.
2. Create `frontend/src/pages/<PageName>.tsx` with:
   - Strict TypeScript — explicit return types on exported functions
   - Tailwind CSS only for styling (no CSS files, no inline style objects)
   - `fetch()` calls directly in the component or a small co-located hook in the same file — no global API client
   - Loading and empty states handled
   - If it uses club/bag data, consume BagContext
3. Add the route to `frontend/src/App.tsx` — pick a sensible URL path
4. Add a nav link in the appropriate nav component if one exists
5. Report back: component file, route path, API endpoints it calls, and any assumptions about data shape.

Do not add comments explaining what the code does. Use Recharts for any charts.
