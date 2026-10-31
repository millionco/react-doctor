// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic local-result regression
// file-path: src/view.tsx
// verdict: fail
const _readLocalSettings = (raw: string) => {
  const parsed = JSON.parse(raw);
  return parsed.settings;
};
