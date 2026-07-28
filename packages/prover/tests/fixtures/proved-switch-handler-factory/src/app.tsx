interface HandlerOptions {
  mode: "primary" | "secondary";
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  switch (options.mode) {
    case "primary":
      return options.primaryHandler;
    case "secondary":
      return options.secondaryHandler;
  }
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
