// rule: hook-import-rename-loses-use-prefix
// weakness: provenance
// source: deep review of PR #1359

import {
  useEffect as useSideEffect,
  useEffectEvent as useEventCallback,
  useImperativeHandle as useHandle,
} from "react";

export const useTrackedValue = (value: string, ref: unknown) => {
  useSideEffect(() => console.log(value), []);
  useHandle(ref, () => ({ value }), []);
  return useEventCallback(() => value);
};
