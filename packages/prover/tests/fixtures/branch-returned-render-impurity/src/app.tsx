const chooseRenderWork = (isPrimary: boolean) => {
  if (isPrimary) return () => undefined;
  return () => console.log("render");
};

export const Application = () => {
  const runRenderWork = chooseRenderWork(true);
  runRenderWork();
  return <main>Application</main>;
};
