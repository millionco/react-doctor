import { useLayoutEffect, useMemo, useRef } from "react";

const useEventCallback = (callback: () => void) => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useMemo(() => () => callbackRef.current(), []);
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
