// rule: html-no-nested-interactive
// weakness: dynamic-computed
// source: final adversarial parity review
// verdict: pass

export const Menu = ({ elementProperties }) => (
  <div role="button" {...elementProperties}>
    <input aria-label="Search" />
  </div>
);
