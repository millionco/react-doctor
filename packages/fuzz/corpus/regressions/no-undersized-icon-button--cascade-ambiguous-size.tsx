// rule: no-undersized-icon-button
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const CloseButton = () => (
  <button aria-label="Close" className="size-4 size-6 p-0">
    <CloseIcon />
  </button>
);
