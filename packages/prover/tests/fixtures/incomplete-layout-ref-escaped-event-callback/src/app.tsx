import { useCallback, useLayoutEffect, useRef } from "react";

interface CallbackRef {
  current: () => void;
}

const inspectCallbackRef = (callbackRef: CallbackRef) => Boolean(callbackRef.current);

const useEventCallback = (callback: () => void) => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  inspectCallbackRef(callbackRef);
  return useCallback(() => callbackRef.current(), []);
};

export const Application = () => {
  const recordActivation = () => undefined;
  const handleClick = useEventCallback(recordActivation);
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
