interface HandlerOptions {
  fallbackHandler: () => void;
  primaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  for (const [handler, ...remainingHandlers] of [
    [options.primaryHandler, options.fallbackHandler],
  ]) {
    if (remainingHandlers.length > 0) return handler;
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
