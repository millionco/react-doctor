// rule: no-transition-all
// weakness: longhand-composition
// source: 0.8.1-to-main all-rules audit
// verdict: fail

export const TransitionCard = () => (
  <div style={{ transitionProperty: "all", transitionDuration: "200ms" }} />
);

export const TailwindTransitionCard = () => <div className="[transition:all] duration-200" />;

export const ResponsiveTransitionCard = () => (
  <div className="transition-all duration-0 md:hover:duration-200" />
);
