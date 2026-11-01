// rule: region-has-accessible-name
// weakness: control-flow
// verdict: fail
// source: author-created control-flow regression
const View = () => {
  try {
    return null;
  } finally {
    return <section role="region" />;
  }
};
