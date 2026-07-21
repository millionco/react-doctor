// rule: no-tiny-uppercase-tracked-label
// weakness: static-value-guard
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Label = () => (
  <span className="text-[10px] uppercase tracking-wide tracking-[0rem]">Recent activity</span>
);
