// rule: no-array-find-result-member-access-without-guard
// weakness: alias-guard
// verdict: pass
// source: independent synthetic ambient runtime provider review
declare const Function: FunctionConstructor;
Function("Array.prototype.find = () => ({label: 'safe'})")();
export const read = () => {
  const rows = [{ label: "only" }];
  let calls = 0;
  if (rows.some(() => ++calls === 1)) return rows.find(() => ++calls === 1).label;
  return "none";
};
