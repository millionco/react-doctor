interface RenderWorkOptions {
  mode: "safe" | "impure";
}

const chooseRenderWork = (options: RenderWorkOptions) => {
  switch (options.mode) {
    case "safe":
      return () => undefined;
    case "impure":
      return () => console.log("render");
  }
};

export const Application = () => {
  const runRenderWork = chooseRenderWork({ mode: "safe" });
  runRenderWork();
  return <main>Application</main>;
};
