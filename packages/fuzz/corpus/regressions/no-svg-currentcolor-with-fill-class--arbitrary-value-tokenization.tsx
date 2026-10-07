// rule: no-svg-currentcolor-with-fill-class
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const Icon = () => <svg className="[--paint:x fill-red-500 y]" fill="currentColor" />;
