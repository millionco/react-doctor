// rule: no-smooth-scroll-without-reduced-motion
// weakness: utility-cascade
// source: Tailwind utility cascade contract audit
// verdict: pass

export const AmbiguousScrollBehavior = () => (
  <>
    <main className="scroll-smooth scroll-auto" />
    <main className="!scroll-smooth !scroll-auto" />
    <main className="scroll-smooth motion-reduce:scroll-auto motion-reduce:scroll-smooth" />
  </>
);
