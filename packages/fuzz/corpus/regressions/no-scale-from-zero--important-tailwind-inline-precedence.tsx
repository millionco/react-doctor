// rule: no-scale-from-zero
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const StaticScale = () => (
  <div
    className="!scale-100 !transition-none !duration-0"
    style={{ transform: "scale(0)", transition: "transform 200ms" }}
  />
);
