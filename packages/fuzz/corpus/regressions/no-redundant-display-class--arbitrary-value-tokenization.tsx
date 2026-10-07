// rule: no-redundant-display-class
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const Card = () => <div className="[--display:x block y]" />;
