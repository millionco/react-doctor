// rule: no-array-find-result-member-access-without-guard
// weakness: name-heuristic
// source: synthetic uppercase non-array provider
// verdict: pass
const Items = { find: () => ({ name: "result" }) };
export const read = () => Items.find((item) => item.enabled).name;
