interface HandlerOptions {
  mode: "primary" | "secondary";
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  for (const handler of [options.primaryHandler, options.secondaryHandler]) {
    const selectedHandler =
      options.mode === "primary" ? options.primaryHandler : options.secondaryHandler;
    if (handler === selectedHandler) return handler;
  }
  return options.secondaryHandler;
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
