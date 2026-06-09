import { loadDashboard, type DashboardSources } from "./load-dashboard.ts";

// Existing server component that consumes the loader (keeps load-dashboard.ts
// reachable). Do not edit.
export default async function DashboardPage({ sources }: { sources: DashboardSources }) {
  const data = await loadDashboard(sources);
  return (
    <main>
      <h1>{data.user}</h1>
      <p>{data.stats}</p>
    </main>
  );
}
