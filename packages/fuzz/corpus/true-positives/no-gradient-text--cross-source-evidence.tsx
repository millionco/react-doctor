// rule: no-gradient-text
// weakness: cross-source
// source: 0.8.1 parity deep review
// verdict: fail

export const InlineTransparentHeading = () => (
  <h1 className="bg-clip-text bg-linear-to-r" style={{ color: "transparent" }}>
    Title
  </h1>
);
