// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic provider and binding regression
// file-path: src/view.tsx
// verdict: fail
const _readLocalSettings = (raw: string) => {
  const parsed = JSON.parse(raw);
  const value = parsed.value;
  {
    interface parsed {}
    consume(parsed.value);
  }
  return value;
};
