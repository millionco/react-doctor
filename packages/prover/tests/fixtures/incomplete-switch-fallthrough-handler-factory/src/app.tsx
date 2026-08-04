interface HandlerOptions {
  mode: "primary" | "secondary";
  shouldUsePrimary: boolean;
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  switch (options.mode) {
    case "primary":
      if (options.shouldUsePrimary) return options.primaryHandler;
    case "secondary":
      return options.secondaryHandler;
  }
};

export const Application = () => {
  const handleClick = chooseHandler({
    mode: "primary",
    shouldUsePrimary: true,
    primaryHandler: () => undefined,
    secondaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
