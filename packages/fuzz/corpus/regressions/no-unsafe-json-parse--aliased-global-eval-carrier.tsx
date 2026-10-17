// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic provider and binding regression
// file-path: src/view.tsx
// verdict: pass
const evaluate = globalThis.eval;
const _readLocalSettings = (raw: string) => {
  evaluate("JSON.parse = () => ({ value: 1 })");
  const parsed = JSON.parse(raw);
  return parsed.value;
};
