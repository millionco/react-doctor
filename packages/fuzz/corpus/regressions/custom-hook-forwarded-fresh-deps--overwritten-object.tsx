// rule: exhaustive-deps, no-effect-with-fresh-deps
// weakness: overwritten-object-property
// source: adversarial review of React Bench validation

import { useEffect } from "react";

const STABLE_TRIGGER_REFS: unknown[] = [];

const usePicker = ({ triggerRefs }: { triggerRefs: ReadonlyArray<unknown> }): void => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};

export const useOverwrittenPickerOptions = (inputRef: unknown): void => {
  const pickerOptions = { triggerRefs: [inputRef] };
  pickerOptions.triggerRefs = STABLE_TRIGGER_REFS;
  usePicker(pickerOptions);
};
