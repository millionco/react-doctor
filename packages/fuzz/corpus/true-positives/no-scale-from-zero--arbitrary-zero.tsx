// rule: no-scale-from-zero
// weakness: arbitrary-value
// source: 0.8.1-to-main all-rules audit
// verdict: fail

export const HiddenDot = () => <span className="scale-[0] transition-transform" />;
