export const Application = () => {
  const firstCallback = () => undefined;
  const secondCallback = () => undefined;
  const handleClick = () => {
    const callbacks = { activate: firstCallback };
    callbacks.activate = secondCallback;
    callbacks.activate();
  };
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
