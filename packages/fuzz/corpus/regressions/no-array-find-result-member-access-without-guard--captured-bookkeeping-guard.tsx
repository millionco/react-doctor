// rule: no-array-find-result-member-access-without-guard
// weakness: alias-guard
// verdict: pass
// source: independent synthetic repeated predicate review
export const read = () => {
  const rows = [{ label: "only", enabled: true }];
  let calls = 0;
  if (
    rows.some((row) => {
      calls++;
      return row.enabled;
    })
  )
    return rows.find((row) => {
      calls++;
      return row.enabled;
    }).label;
  return "none";
};
