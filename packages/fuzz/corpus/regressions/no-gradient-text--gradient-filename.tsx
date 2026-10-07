// rule: no-gradient-text
// weakness: name-heuristic
// source: 0.8.1 parity deep review
// verdict: pass

export const GradientAssetHeading = () => (
  <h1
    style={{
      color: "transparent",
      backgroundClip: "text",
      backgroundImage: "url('/linear-gradient(red).png')",
    }}
  >
    Title
  </h1>
);
