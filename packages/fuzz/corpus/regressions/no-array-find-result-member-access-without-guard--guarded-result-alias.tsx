// pass
// rule: no-array-find-result-member-access-without-guard
// weakness: alias-guard
// source: independently synthetic readonly find-result contract
export const FindLabel = ({ items, selected }) => {
  const found = items.find((item) => item.id === selected);
  if (!found) return null;
  return <span>{found.label}</span>;
};
