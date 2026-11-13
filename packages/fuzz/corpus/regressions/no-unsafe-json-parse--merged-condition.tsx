// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic provider and binding regression
// file-path: src/view.tsx
// verdict: fail
const _readLocalSettings = (enabled: boolean, raw: string) => {
  interface enabled {}
  const parsed = enabled ? JSON.parse(raw) : {};
  return parsed.value;
};
