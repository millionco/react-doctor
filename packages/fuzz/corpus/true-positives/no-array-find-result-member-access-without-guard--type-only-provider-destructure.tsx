// rule: no-array-find-result-member-access-without-guard
// weakness: name-heuristic
// source: independently synthetic nested erased provider regression
// verdict: fail

type Callback = ({ prototype }: { prototype: unknown }) => void;
const ITEMS = [{ name: "first", enabled: false }];
export const read = () => ITEMS.find((item) => item.enabled).name;
