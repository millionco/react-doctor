import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const useEventCallback = (callback: () => void) => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
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
