// rule: no-undersized-icon-button
// weakness: parser-confusion
// source: 0.8.1-to-main all-rules parity audit
// verdict: fail

export const CloseButton = () => (
  <button aria-label="Close" className="size-4 p-0 [--label:'before:']">
    <CloseIcon />
  </button>
);
