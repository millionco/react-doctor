// rule: exhaustive-deps
// weakness: default-parameter, alias-guard
// source: synthetic native parity regression
import { useCallback, useMemo, useState } from "react";

const elements = [{ value: 1 }];

export const ModuleArray = () => useMemo(() => elements.map((element) => element.value), []);

export const MissingBeforeRedundant = (props: { value: number }) => {
  const [count] = useState(0);
  return useCallback(() => props.value + count, [props, props.value]);
};

export const makeHook = (outer: string) => {
  return function useThing({ serialize = (value: string) => value + outer }) {
    return useCallback((value: string) => serialize(value), []);
  };
};
