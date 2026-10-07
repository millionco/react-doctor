// rule: no-scale-from-zero
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules audit
// verdict: pass

export const StableScale = () => (
  <>
    <div className="!scale-100 scale-0 transition-transform" />
    <div className="scale-0 transition-none transition-transform" />
    <div className="motion-safe:scale-0 motion-reduce:transition-transform" />
  </>
);
