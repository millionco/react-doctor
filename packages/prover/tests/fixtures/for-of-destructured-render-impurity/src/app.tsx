interface ApplicationProps {
  useImpureWork: boolean;
}

const runSelectedWork = (useImpureWork: boolean) => {
  for (const { renderWork } of [
    { renderWork: useImpureWork ? () => console.log("render") : () => undefined },
  ]) {
    renderWork();
  }
};

export const Application = ({ useImpureWork }: ApplicationProps) => {
  runSelectedWork(useImpureWork);
  return <main>Application</main>;
};
