// rule: no-array-find-result-member-access-without-guard
// weakness: framework-gating
// verdict: pass
// source: independent synthetic canonical Next navigation exit review
import { permanentRedirect } from "next/navigation";
export const readLabel = (rows, selected) => {
  const found = rows.find((row) => row.id === selected);
  if (!found) permanentRedirect("/missing");
  return found.label;
};
