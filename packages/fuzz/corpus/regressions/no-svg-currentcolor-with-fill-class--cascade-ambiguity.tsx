// rule: no-svg-currentcolor-with-fill-class
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const AmbiguousIcon = () => (
  <svg className="fill-red-500 fill-blue-500" fill="currentColor" />
);

export const ResetIcon = () => (
  <svg className="stroke-green-500 !stroke-none" stroke="currentColor" />
);
