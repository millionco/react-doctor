// rule: no-scale-from-zero
// weakness: property-override-order
// source: 0.8.1-to-main all-rules audit
// verdict: pass

export const Dot = () => (
  <span
    style={{
      transform: "scale(0)",
      transition: "transform 200ms",
      transitionProperty: "opacity",
    }}
  />
);

export const StaticDot = () => (
  <span
    style={{
      transform: "scale(0)",
      transitionProperty: "transform",
      transitionDuration: "0s",
    }}
  />
);

export const InvalidTransitionDot = () => (
  <span style={{ transform: "scale(0)", transition: "opacity transform 200ms" }} />
);

export const StaticTailwindDot = () => <span className="scale-0 transition-transform duration-0" />;

export const InlineDurationOverrideDot = () => (
  <span
    className="scale-0 transition-transform duration-200"
    style={{ transitionDuration: "0s" }}
  />
);

export const UnversionedIndividualScaleDot = () => (
  <span className="transition-transform duration-200" style={{ scale: 0 }} />
);
