// verdict: pass
// rule: no-array-find-result-member-access-without-guard
// weakness: framework-gating
// source: independently synthetic Next.js documented notFound exit contract
import { notFound } from "next/navigation";

export const SelectedLabel = ({ items, selected }) => {
  const found = items.find((item) => item.id === selected);
  if (!found) notFound();
  return <span>{found.label}</span>;
};
