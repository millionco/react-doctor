// rule: no-gradient-text
// weakness: value-parser
// source: 0.8.1 parity deep review
// verdict: fail

export const ModernTransparentGradient = () => (
  <h1
    style={{
      color: "oklch(60% 0.2 240 / 0%)",
      backgroundClip: "text",
      backgroundImage: "linear-gradient(red, blue)",
    }}
  >
    Title
  </h1>
);
