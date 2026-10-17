// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// weakness: native-location-query-shape
// source: independent synthetic native search fallback boundary
export const readQueryPairs = () => (window.location.search || "?").split("?")[1].split("&");
