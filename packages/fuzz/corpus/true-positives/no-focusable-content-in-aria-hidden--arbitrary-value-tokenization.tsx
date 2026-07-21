// rule: no-focusable-content-in-aria-hidden
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: fail

export const HiddenAction = () => (
  <div aria-hidden>
    <button className="[--state:x hidden y]">Save</button>
  </div>
);
