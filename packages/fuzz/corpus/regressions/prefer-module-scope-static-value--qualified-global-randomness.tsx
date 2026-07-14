// rule: prefer-module-scope-static-value
// weakness: alias-guard
// source: ISSUES_TO_FIX_ASAP.md 2026-07-12 qualified global randomness

export const RandomIdentity = () => {
  const row = { id: globalThis.crypto.randomUUID() };
  return <span>{row.id}</span>;
};
