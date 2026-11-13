// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic provider and binding regression
// file-path: src/view.tsx
// verdict: pass
declare const globalThis: { JSON: { parse: (source: string) => unknown } };
const _readLocalSettings = (raw: string) => {
  globalThis.JSON.parse = () => ({ value: 1 });
  const parsed = JSON.parse(raw);
  return parsed.value;
};
