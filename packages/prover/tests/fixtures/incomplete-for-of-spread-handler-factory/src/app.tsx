interface HandlerOptions {
  handlers: ReadonlyArray<() => void>;
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  for (const handler of [...options.handlers]) {
    return handler;
  }
  return options.secondaryHandler;
};

export const Application = () => {
  const handleClick = chooseHandler({
    handlers: [() => undefined],
    primaryHandler: () => undefined,
    secondaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
