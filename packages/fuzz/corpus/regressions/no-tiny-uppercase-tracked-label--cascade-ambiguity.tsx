// rule: no-tiny-uppercase-tracked-label
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const Label = () => (
  <span className="text-sm text-[10px] uppercase tracking-wide">Recent activity</span>
);
