// rule: no-scale-from-zero
// weakness: individual-transform-property
// source: 0.8.1-to-main all-rules audit
// verdict: fail

export const HiddenDot = () => <span style={{ scale: 0, transition: "scale 200ms" }} />;

export const HiddenTailwindDot = () => (
  <span className="scale-x-0 [transition:transform] duration-200" />
);

export const ResponsiveHiddenDot = () => (
  <span className="scale-0 transition-transform duration-0 md:hover:duration-200" />
);

export const TailwindScaleInlineTransitionDot = () => (
  <span className="scale-0" style={{ transition: "transform 200ms" }} />
);

export const TailwindTransitionInlineScaleDot = () => (
  <span className="transition-transform duration-200" style={{ transform: "scale(0)" }} />
);

export const TailwindScaleTransitionInlineScaleDot = () => (
  <span className="transition-[scale]" style={{ scale: 0 }} />
);
