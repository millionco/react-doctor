interface ApplicationProps {
  useImpureWork: boolean;
}

const chooseRenderWork = (useImpureWork: boolean) => {
  while (useImpureWork) return () => console.log("render");
  return () => undefined;
};

export const Application = ({ useImpureWork }: ApplicationProps) => {
  const runRenderWork = chooseRenderWork(useImpureWork);
  runRenderWork();
  return <main>Application</main>;
};
