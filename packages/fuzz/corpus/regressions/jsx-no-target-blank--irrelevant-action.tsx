// rule: jsx-no-target-blank
// weakness: framework-gating
// source: adversarial parity review
// verdict: pass
export const DocumentationLink = () => (
  <a href="/docs" action="https://example.com" target="_blank">
    Documentation
  </a>
);
