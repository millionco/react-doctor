// rule: no-smooth-scroll-without-reduced-motion
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const Page = () => (
  <main className="motion-reduce:!scroll-auto" style={{ scrollBehavior: "smooth" }} />
);
