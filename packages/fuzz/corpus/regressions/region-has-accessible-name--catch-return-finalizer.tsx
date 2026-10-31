// rule: region-has-accessible-name
// weakness: control-flow
// verdict: fail
// source: author-created control-flow regression
const View = () => {
  try {
    throw new Error("stop");
  } catch {
    return null;
  } finally {
    return <section role="region" />;
  }
};
