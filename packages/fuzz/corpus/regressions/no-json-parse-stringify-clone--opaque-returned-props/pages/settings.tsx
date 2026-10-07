// rule: no-json-parse-stringify-clone
// weakness: framework-gating, opacity
// source: Bugbot PR #1498
// verdict: fail

export const getServerSideProps = async () => {
  const serializedState = JSON.parse(JSON.stringify(state));
  return {
    props: {
      serializedState,
      escaped: consume(serializedState),
    },
  };
};
