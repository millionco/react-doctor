export const Application = () => {
  const firstHandler = () => undefined;
  const secondHandler = () => undefined;
  const buttonProperties = {
    onClick: firstHandler,
  };
  buttonProperties.onClick = secondHandler;
  return (
    <button type="button" {...buttonProperties}>
      Activate
    </button>
  );
};
