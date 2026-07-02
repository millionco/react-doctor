// rule: exhaustive-deps
// weakness: wrapper-transparency
// source: FP-FIX history (module consts as param defaults; factory-scope captures)
import { forwardRef, useCallback, useEffect } from "react";

const SOME_MODULE_CONST = { a: 1 };

export const useStableOptions = () => useCallback((opts = SOME_MODULE_CONST) => opts, []);

export const buildComponent = (logger: (value: string) => void) =>
  forwardRef<HTMLDivElement, { value: string }>((props, ref) => {
    useEffect(() => {
      logger(props.value);
    }, [props.value]);
    return <div ref={ref} />;
  });
