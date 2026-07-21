// rule: no-outline-none
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: fail

export const Action = () => (
  <button className="[--focus:x focus:ring-2 fallback]" style={{ outline: "none" }}>
    Save
  </button>
);
