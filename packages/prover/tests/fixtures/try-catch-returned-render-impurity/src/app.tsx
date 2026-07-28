const chooseRenderWork = () => {
  try {
    return () => undefined;
  } catch {
    return () => console.log("render");
  }
};

export const Application = () => {
  const runRenderWork = chooseRenderWork();
  runRenderWork();
  return <main>Application</main>;
};
