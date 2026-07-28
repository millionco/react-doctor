interface HandlerOptions {
  fallbackHandler: () => void;
  primaryHandler: () => void;
}

const handlerKey = "handler" as const;

const chooseHandler = (options: HandlerOptions) => {
  for (const { [handlerKey]: handler } of [{ handler: options.primaryHandler }]) {
    return handler;
  }
  return options.fallbackHandler;
};

export const Application = () => {
  const handleClick = chooseHandler({
    fallbackHandler: () => undefined,
    primaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
