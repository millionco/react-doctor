// verdict: pass
// rule: no-array-find-result-member-access-without-guard
// weakness: alias-guard
// source: independently synthetic compound early-exit contract
export const SelectedLabel = ({ items, selected, fallback }) => {
  const primary = items.find((item) => item.id === selected);
  const secondary = items.find((item) => item.id === fallback);
  if (!primary || !secondary) return null;
  return <span>{secondary.label}</span>;
};
