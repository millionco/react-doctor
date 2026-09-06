// rule: js-set-map-lookups
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: pass

export const inspect = (values) => {
  const [{ source: urlSource }] = useSearch();
  const selected = urlSource;
  return values.filter((value) => selected.includes(value));
};
