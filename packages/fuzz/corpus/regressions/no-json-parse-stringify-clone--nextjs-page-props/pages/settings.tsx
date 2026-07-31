// rule: no-json-parse-stringify-clone
// weakness: framework-gating, control-flow, transparent-wrapper
// source: ReactBench RDFPFN792026 exact 15-unit false-positive partition; Bugbot PR #1498

export const getServerSideProps = withSessionSsr(async ({ req }) => {
  const apiKeys = await loadApiKeys();
  const jsonSafeUser = JSON.parse(JSON.stringify(req.session.user));
  const serializedUser = jsonSafeUser;
  return {
    props: {
      user: serializedUser,
      apiKeys: JSON.parse(JSON.stringify(apiKeys)),
    },
  };
});

export const getStaticProps = async ({ missing }) =>
  missing
    ? { notFound: true }
    : ({
        props: {
          apiKeys: JSON.parse(JSON.stringify(loadApiKeys())),
        },
      } satisfies GetStaticPropsResult);
