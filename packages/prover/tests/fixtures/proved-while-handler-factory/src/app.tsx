interface HandlerOptions {
  preferPrimary: boolean;
  primaryHandler: () => void;
  secondaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  while (options.preferPrimary) return options.primaryHandler;
  return options.secondaryHandler;
};

export const Application = () => {
  const handleClick = chooseHandler({
    preferPrimary: false,
    primaryHandler: () => undefined,
    secondaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
