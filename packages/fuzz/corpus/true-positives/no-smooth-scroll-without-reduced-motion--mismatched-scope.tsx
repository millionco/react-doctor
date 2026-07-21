// rule: no-smooth-scroll-without-reduced-motion
// weakness: variant-scope
// source: Tailwind reduced-motion scope audit
// verdict: fail

export const ResponsiveSmoothScroll = () => (
  <main className="lg:scroll-smooth md:motion-reduce:scroll-auto" />
);
