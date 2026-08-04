const chooseHandler = (isEnabled: boolean, handler: () => void) => {
  if (isEnabled) return handler;
};

export const Application = () => {
  const activate = () => undefined;
  const handleClick = chooseHandler(true, activate);
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
