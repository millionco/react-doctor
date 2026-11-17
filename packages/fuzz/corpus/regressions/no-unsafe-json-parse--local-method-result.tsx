// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic terminal local method
// file-path: src/result-view.tsx
// verdict: fail
const _readFirstActiveItem = (raw: string) => {
  const parsed = JSON.parse(raw);
  return parsed.find((item) => item.active);
};
