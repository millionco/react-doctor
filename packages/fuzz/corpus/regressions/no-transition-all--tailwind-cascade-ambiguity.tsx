// rule: no-transition-all
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules audit
// verdict: pass

export const SpecificTransition = () => (
  <div className="!transition-none transition-all hover:transition-none hover:transition-all" />
);
