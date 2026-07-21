// rule: no-gradient-text
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const SolidHeading = () => (
  <h1
    className="!text-black !bg-clip-border !bg-none"
    style={{
      backgroundClip: "text",
      backgroundImage: "linear-gradient(red, blue)",
      color: "transparent",
    }}
  >
    Solid
  </h1>
);
