// rule: async-defer-await
// verdict: pass
// weakness: name-heuristic
// source: React Bench 0.9.6 exhaustive audit

declare const getOrganizationConfig: () => Promise<string>;
declare const render: (value: string) => void;
declare let ignore: boolean;

export const refreshHostedCart = async () => {
  const config = await getOrganizationConfig();
  if (ignore) return;
  render(config);
};
