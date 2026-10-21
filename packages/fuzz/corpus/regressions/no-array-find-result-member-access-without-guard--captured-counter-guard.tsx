// rule: no-array-find-result-member-access-without-guard
// weakness: alias-guard
// verdict: fail
// source: independent synthetic repeated predicate review
export const read = () => {
  const rows = [{ label: "only" }];
  let calls = 0;
  if (rows.some(() => ++calls === 1)) return rows.find(() => ++calls === 1).label;
  return "none";
};
