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

// TODO(agent): implement. See instruction.md.
export const loadDashboard = async (_sources: DashboardSources): Promise<DashboardData> => {
  throw new Error("not implemented");
};
