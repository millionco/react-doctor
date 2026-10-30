// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: fail
// weakness: native-location-query-shape
// source: independent synthetic native search fallback boundary
export const readQueryPairs = () => (window.location.search || "").split("?")[1].split("&");
