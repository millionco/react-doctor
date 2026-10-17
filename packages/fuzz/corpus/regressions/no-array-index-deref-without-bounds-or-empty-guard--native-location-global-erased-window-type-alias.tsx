// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// source: independent synthetic native query runtime-binding regression
type window = unknown;
export const readSection = () => (window.location.search || "?").split("?")[1].split("&");
