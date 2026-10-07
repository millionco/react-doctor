// rule: async-defer-await
// verdict: pass
// weakness: name-heuristic
// source: issue #1758

declare const refreshSession: () => Promise<boolean>;
declare const setOk: (value: boolean) => void;

const run = { live: true };

export const effect = async () => {
  const refreshed = await refreshSession();
  if (!run.live) return;
  setOk(refreshed);
};
