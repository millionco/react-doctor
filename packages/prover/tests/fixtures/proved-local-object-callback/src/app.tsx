interface CallbackRegistry {
  activate: () => void;
}

const invokeRegisteredCallback = (registry: CallbackRegistry) => registry.activate();

export const Application = () => {
  const recordActivation = () => undefined;
  const handleClick = () => {
    const registry = { activate: recordActivation };
    invokeRegisteredCallback(registry);
  };
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
