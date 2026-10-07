// rule: html-no-nested-interactive
// weakness: aria-role-token-fallback
// source: final adversarial parity review
// verdict: fail

export const Menu = () => (
  <div role="unsupported BUTTON">
    <input aria-label="Search" />
  </div>
);
