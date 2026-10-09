// rule: no-array-index-as-key
// verdict: pass
export const Loader = () =>
  ["*", "*", "*"].map((glyph, index) => <Glyph key={index} value={glyph} delay={index * 0.1} />);
