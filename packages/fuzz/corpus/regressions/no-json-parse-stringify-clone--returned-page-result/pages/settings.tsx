// rule: no-json-parse-stringify-clone
// weakness: framework-gating, returned-binding
// source: Bugbot PR #1498
// verdict: pass

export const getServerSideProps = async ({ missing }) => {
  const response = missing
    ? { notFound: true }
    : { props: { state: JSON.parse(JSON.stringify(state)) } };
  return response;
};
