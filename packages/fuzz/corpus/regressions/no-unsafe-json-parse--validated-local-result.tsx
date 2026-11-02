// rule: no-unsafe-json-parse
// weakness: alias-guard
// source: independent synthetic local-result regression
// file-path: src/view.tsx
// verdict: pass
const _readLocalSettings = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return parsed.settings;
  } catch {
    return undefined;
  }
};
