// rule: no-object-keys-values-entries-on-maybe-undefined
// weakness: control-flow
// source: PR #1402 local Daytona parity

const buildQuery = (query?: Record<string, string>) => {
  if (!query || !Object.keys(query).length) return "";
  return Object.entries(query)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
};

export { buildQuery };
