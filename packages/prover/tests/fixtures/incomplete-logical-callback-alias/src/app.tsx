const callbackRegistry = new Map<string, () => void>();

const registerCallback = (callback: (() => void) | undefined) => {
  const selectedCallback = callback || (() => undefined);
  callbackRegistry.set("activate", selectedCallback);
};

export const Application = () => {
  const handleClick = () => {
    registerCallback(() => undefined);
  };
  return (
    <button type="button" onClick={handleClick}>
      Register
    </button>
  );
};
