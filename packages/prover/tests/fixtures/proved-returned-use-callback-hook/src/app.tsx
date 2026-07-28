import { useCallback } from "react";

const useGuardedCallback = (callback: () => void) => useCallback(() => callback(), [callback]);

export const Application = () => {
  const recordActivation = () => undefined;
  const handleClick = useGuardedCallback(recordActivation);
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
