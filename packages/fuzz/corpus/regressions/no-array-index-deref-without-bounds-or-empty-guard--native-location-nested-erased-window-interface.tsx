// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// source: independent synthetic native query runtime-binding regression
export const readSection = () => {
  interface window {}
  return (window.location.search || "?").split("?")[1].trim();
};
