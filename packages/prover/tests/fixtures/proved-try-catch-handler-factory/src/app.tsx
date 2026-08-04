interface HandlerOptions {
  primaryHandler: () => void;
  fallbackHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  try {
    return options.primaryHandler;
  } catch {
    return options.fallbackHandler;
  }
};

export const Application = () => {
  const handleClick = chooseHandler({
    primaryHandler: () => undefined,
    fallbackHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
