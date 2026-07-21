// rule: only-export-components
// weakness: framework-gating
// source: 0.8.1-to-main all-rules adversarial review
// verdict: fail

export const loader = async () => null;

export const Widget = () => <div />;
