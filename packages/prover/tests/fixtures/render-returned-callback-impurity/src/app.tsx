const createRenderWork = (callback: () => void) => () => callback();

const recordCurrentValue = () => console.log("render");

export const Application = () => {
  const runRenderWork = createRenderWork(recordCurrentValue);
  runRenderWork();
  return <main>Application</main>;
};
