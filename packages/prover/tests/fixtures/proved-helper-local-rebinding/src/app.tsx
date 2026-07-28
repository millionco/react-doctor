const computeRevision = () => {
  let revision = 0;
  revision += 1;
  return revision;
};

export const Application = () => {
  const revision = computeRevision();
  return <main>Revision {revision}</main>;
};
