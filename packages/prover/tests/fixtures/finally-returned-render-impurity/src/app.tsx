const chooseRenderWork = (useImpureWork: boolean) => {
  try {
    return () => undefined;
  } finally {
    if (useImpureWork) return () => console.log("render");
  }
};

export const Application = () => {
  const runRenderWork = chooseRenderWork(false);
  runRenderWork();
  return <main>Application</main>;
};
