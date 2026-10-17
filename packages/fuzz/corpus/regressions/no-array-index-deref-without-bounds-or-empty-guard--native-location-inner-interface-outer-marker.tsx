// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// source: independent synthetic native query runtime-binding regression
const marker = 1;
export const readSection = () => {
  interface marker {}
  void marker;
  return (window.location.search || "?").split("?")[1].trim();
};
