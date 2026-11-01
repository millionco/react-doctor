// rule: region-has-accessible-name
// weakness: control-flow
// verdict: fail
// source: author-created control-flow regression
const View = () => {
  for (;;) {
    try {
      continue;
    } finally {
      return <section role="region" />;
    }
  }
};
