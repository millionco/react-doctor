// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: value-proof
// source: synthetic audit regression
export const readMode = () => {
  const text = "mode:";
  return text.split(":")[1].trim();
};
