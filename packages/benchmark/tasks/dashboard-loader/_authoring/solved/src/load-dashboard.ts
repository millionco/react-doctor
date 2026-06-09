export interface DashboardSources {
  fetchUser: () => Promise<string>;
  fetchStats: () => Promise<number>;
  fetchActivity: () => Promise<string[]>;
}

export interface DashboardData {
  user: string;
  stats: number;
  activity: string[];
}

// The three sources are independent, so fetch them in parallel rather than
// awaiting each in sequence (which would serialize three round-trips).
export const loadDashboard = async (sources: DashboardSources): Promise<DashboardData> => {
  const [user, stats, activity] = await Promise.all([
    sources.fetchUser(),
    sources.fetchStats(),
    sources.fetchActivity(),
  ]);
  return { user, stats, activity };
};
