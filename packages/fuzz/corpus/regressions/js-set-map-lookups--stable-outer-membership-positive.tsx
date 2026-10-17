// rule: js-set-map-lookups
// verdict: fail
// weakness: iteration-provenance
// source: independently authored stable collection positive control

export const selectAllowedRows = (rows: { name: string }[], allowed: string[]) =>
  rows.every((row) => allowed.includes(row.name));
