Implement `loadDashboard` in `src/load-dashboard.ts`.

## Expected behavior

`loadDashboard(sources)` loads the three pieces of dashboard data from the
provided `sources` and returns them combined:

- Calls `sources.fetchUser()`, `sources.fetchStats()`, and
  `sources.fetchActivity()`.
- Returns `{ user, stats, activity }` with each field set to the resolved value
  of the matching call.

The three sources are independent of one another.

Example: if `fetchUser` resolves to `"Ada"`, `fetchStats` to `42`, and
`fetchActivity` to `["login"]`, then `loadDashboard(sources)` resolves to
`{ user: "Ada", stats: 42, activity: ["login"] }`.

## Constraints

Keep the exported `loadDashboard` signature and the `DashboardSources` /
`DashboardData` interfaces. Do not change `src/dashboard-page.tsx`.
