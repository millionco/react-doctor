// rule: no-scale-from-zero
// weakness: const-alias
// source: 0.8.1-to-main all-rules audit
// verdict: fail

const hiddenClassName = "scale-0 transition-transform";

export const Dot = () => <span className={hiddenClassName} />;
