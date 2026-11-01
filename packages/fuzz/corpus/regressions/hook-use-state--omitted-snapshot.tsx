// rule: hook-use-state
// verdict: pass
// weakness: library-idiom
// source: synthetic immutable value-only tuple
import { useState } from "react";

export const useRetainedMarker = (initialMarker: string) => {
  const [retainedMarker] = useState(initialMarker);
  const [readRetainedMarker] = useState(() => () => retainedMarker);
  return readRetainedMarker;
};
