// rule: no-array-find-result-member-access-without-guard
// weakness: name-heuristic
// source: independently synthetic native array provider regression
// verdict: pass

type Function = unknown;
Function("Array.prototype.find = () => ({ name: 'custom' })")();
const ITEMS = [{ name: "first", enabled: false }];
export const read = () => ITEMS.find((item) => item.enabled).name;
