// rule: region-has-accessible-name
// weakness: control-flow
// source: synthetic source-review regression
// verdict: pass
// eslint-disable-next-line no-constant-binary-expression
export const HiddenRegion = () => false && <section role="region" />;
