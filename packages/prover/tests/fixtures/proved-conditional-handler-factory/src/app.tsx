const chooseHandler = (
  isPrimary: boolean,
  primaryHandler: () => void,
  secondaryHandler: () => void,
) => {
  if (isPrimary) return primaryHandler;
  return secondaryHandler;
};

export const Application = () => {
  const primaryHandler = () => undefined;
  const secondaryHandler = () => undefined;
  const handleClick = chooseHandler(true, primaryHandler, secondaryHandler);
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
