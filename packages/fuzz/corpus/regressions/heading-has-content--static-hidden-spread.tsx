// rule: heading-has-content
// weakness: wrapper-transparency
// source: adversarial all-rules parity review
// verdict: pass

export const HiddenHeading = () => <h1 {...{ "aria-hidden": true }} />;
