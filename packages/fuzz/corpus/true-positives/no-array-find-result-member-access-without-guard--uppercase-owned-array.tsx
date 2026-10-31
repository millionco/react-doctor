// rule: no-array-find-result-member-access-without-guard
// weakness: name-heuristic
// source: synthetic closed local array receiver
// verdict: fail
const ITEMS = [{ name: "first", enabled: false }];
export const read = () => ITEMS.find((item) => item.enabled).name;
