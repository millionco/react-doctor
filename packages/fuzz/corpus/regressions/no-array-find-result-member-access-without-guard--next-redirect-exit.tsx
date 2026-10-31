// rule: no-array-find-result-member-access-without-guard
// weakness: framework-gating
// verdict: pass
// source: independent synthetic canonical Next navigation exit review
import { redirect } from "next/navigation";
export const readLabel = (rows, selected) => {
  const found = rows.find((row) => row.id === selected);
  if (!found) redirect("/missing");
  return found.label;
};
