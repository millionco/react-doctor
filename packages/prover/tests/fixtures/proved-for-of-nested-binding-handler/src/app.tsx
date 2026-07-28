interface HandlerOptions {
  mode: "primary" | "secondary";
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  for (const {
    callbacks: [primaryHandler, secondaryHandler],
  } of [{ callbacks: [options.primaryHandler, options.secondaryHandler] }]) {
    return options.mode === "primary" ? primaryHandler : secondaryHandler;
  }
  throw new Error("A fresh nonempty array must produce one iteration");
};

export const Application = () => {
  const handleClick = chooseHandler({
    mode: "primary",
    primaryHandler: () => undefined,
    secondaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
