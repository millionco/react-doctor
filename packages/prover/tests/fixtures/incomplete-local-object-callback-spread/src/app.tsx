interface ApplicationProperties {
  fallbackCallbacks: {
    callback?: () => void;
  };
}

export const Application = ({ fallbackCallbacks }: ApplicationProperties) => {
  const callbacks = {
    callback: () => undefined,
    ...fallbackCallbacks,
  };
  return (
    <button type="button" onClick={callbacks.callback}>
      Activate
    </button>
  );
};
