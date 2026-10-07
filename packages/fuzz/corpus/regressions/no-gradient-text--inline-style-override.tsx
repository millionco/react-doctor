// rule: no-gradient-text
// weakness: cascade-ambiguity
// source: 0.8.1 parity deep review
// verdict: pass

export const SolidHeading = () => (
  <h1 className="text-transparent bg-clip-text bg-linear-to-r" style={{ color: "red" }}>
    Title
  </h1>
);
