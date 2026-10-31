// fail
// rule: no-array-find-result-member-access-without-guard
// weakness: alias-guard
// source: independently synthetic readonly find-result contract
export const FindLabel = ({ items, selected }) => {
  const found = items.find((item) => item.id === selected);
  return <span>{found.label}</span>;
};
