interface HandlerOptions {
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  for (let handler of [options.primaryHandler]) {
    handler = options.secondaryHandler;
    return handler;
  }
  return options.primaryHandler;
};

export const Application = () => {
  const handleClick = chooseHandler({
    primaryHandler: () => undefined,
    secondaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
