const chooseRenderWork = () => {
  try {
    return () => console.log("overridden");
  } finally {
    return () => undefined;
  }
};

export const Application = () => {
  const runRenderWork = chooseRenderWork();
  runRenderWork();
  return <main>Application</main>;
};
