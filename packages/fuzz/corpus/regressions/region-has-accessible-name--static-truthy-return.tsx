// rule: region-has-accessible-name
// weakness: control-flow
// verdict: pass
// source: author-created control-flow regression
const View = () => {
  if (1) return null;
  return <section role="region" />;
};
