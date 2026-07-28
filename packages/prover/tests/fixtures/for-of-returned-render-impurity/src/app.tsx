interface ApplicationProps {
  mode: "safe" | "impure";
}

const chooseRenderWork = (mode: ApplicationProps["mode"]) => {
  for (const renderWork of [mode === "impure" ? () => console.log("render") : () => undefined]) {
    return renderWork;
  }
  throw new Error("A fresh nonempty array must produce one iteration");
};

export const Application = ({ mode }: ApplicationProps) => {
  const runRenderWork = chooseRenderWork(mode);
  runRenderWork();
  return <main>Application</main>;
};
