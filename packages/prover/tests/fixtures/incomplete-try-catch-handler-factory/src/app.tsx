interface HandlerOptions {
  primaryHandler: () => void;
}

const chooseHandler = (options: HandlerOptions) => {
  try {
    return options.primaryHandler;
  } catch {}
};

export const Application = () => {
  const handleClick = chooseHandler({
    primaryHandler: () => undefined,
  });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
