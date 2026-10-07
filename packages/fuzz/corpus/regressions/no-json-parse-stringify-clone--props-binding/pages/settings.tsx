// rule: no-json-parse-stringify-clone
// weakness: framework-gating, props-binding
// source: Bugbot PR #1498
// verdict: pass

export const getServerSideProps = async () => {
  const pageProps = {
    nested: [{ state: JSON.parse(JSON.stringify(state)) }],
  };
  return { props: pageProps };
};
