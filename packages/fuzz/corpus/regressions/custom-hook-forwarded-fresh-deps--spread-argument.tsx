// rule: exhaustive-deps, no-effect-with-fresh-deps, rerender-memo-with-default-value
// weakness: spread-argument-arity
// source: adversarial review of React Bench validation

import { useEffect } from "react";

const usePicker = (triggerRefs: ReadonlyArray<unknown> = []): void => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};

export const useForwardPickerArguments = (
  argumentsForPicker: [] | [ReadonlyArray<unknown>],
): void => {
  usePicker(...argumentsForPicker);
};
