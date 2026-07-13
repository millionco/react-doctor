// rule: exhaustive-deps, no-effect-with-fresh-deps, rerender-memo-with-default-value
// weakness: custom-hook-forwarded-fresh-deps
// source: React Bench write-react-mezzanine-ui-mezzani__BH7ZFrC

import { useEffect, useRef } from "react";

interface PickerOptions {
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly triggerRefs?: ReadonlyArray<React.RefObject<HTMLElement | null>>;
}

const useDocumentEvents = (callback: () => void, dependencies: ReadonlyArray<unknown>): void => {
  useEffect(() => callback(), [callback, dependencies]);
};

const usePicker = ({ inputRef, triggerRefs = [inputRef] }: PickerOptions): void => {
  useDocumentEvents(() => {
    void triggerRefs;
  }, [triggerRefs]);
};

export const Picker = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  usePicker({ inputRef, triggerRefs: [inputRef] });
  usePicker({ inputRef });
  return <input ref={inputRef} />;
};
