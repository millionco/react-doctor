// rule: jsx-no-target-blank
// weakness: source-order
// source: adversarial parity review
// verdict: fail
export const ExternalLink = () => (
  <a href="https://example.com" action="/save" target="_blank">
    External destination
  </a>
);
