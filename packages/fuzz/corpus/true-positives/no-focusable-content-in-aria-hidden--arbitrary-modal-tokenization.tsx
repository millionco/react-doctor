// rule: no-focusable-content-in-aria-hidden
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: fail

export const HiddenAction = () => (
  <div aria-hidden className="[--dialog:x modal y]">
    <button data-bs-dismiss="modal">Close</button>
  </div>
);
