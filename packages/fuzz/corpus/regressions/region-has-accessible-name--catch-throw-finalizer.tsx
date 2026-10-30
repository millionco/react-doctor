// rule: region-has-accessible-name
// weakness: control-flow
// verdict: fail
// source: author-created control-flow regression
const View = () => {
  try {
    throw new Error("first");
  } catch {
    throw new Error("second");
  } finally {
    return <section role="region" />;
  }
};
