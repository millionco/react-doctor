// rule: no-transition-all
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const StaticTransition = () => (
  <div className="!transition-all !duration-0" style={{ transitionDuration: "200ms" }} />
);
