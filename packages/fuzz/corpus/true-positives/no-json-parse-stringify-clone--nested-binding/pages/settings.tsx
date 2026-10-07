// rule: no-json-parse-stringify-clone
// weakness: binding-provenance, escape-analysis
// source: Bugbot PR #1498
// verdict: fail

export const getServerSideProps = async () => {
  const serializedState = (() => {
    const workingCopy = JSON.parse(JSON.stringify(state));
    mutate(workingCopy);
    return workingCopy;
  })();
  return { props: { serializedState } };
};
