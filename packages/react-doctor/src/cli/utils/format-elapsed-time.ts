import { MILLISECONDS_PER_SECOND } from "@react-doctor/core";

export const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < MILLISECONDS_PER_SECOND) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};
