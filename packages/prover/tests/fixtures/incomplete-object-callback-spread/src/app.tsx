interface CallbackOptions {
  callback: () => void;
}

const invokeCallback = (options: CallbackOptions) => options.callback();

export const Application = () => {
  const recordActivation = () => undefined;
  const callbackOptions = { callback: recordActivation };
  const handleClick = () => invokeCallback({ ...callbackOptions });
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
