// rule: region-has-accessible-name
// weakness: control-flow
// verdict: fail
// source: author-created control-flow regression
const View = () => {
  for (;;) {
    try {
      break;
    } finally {
      return <section role="region" />;
    }
  }
  return null;
};
