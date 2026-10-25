/* eslint-disable react/refs */
// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic stored callable initialization
// verdict: pass

import { useRef } from "react";

type Action = () => number;

export const useCachedAction = () => {
  const actionRef = useRef<Action>();
  if (!actionRef.current) actionRef.current = () => 7;
  return actionRef.current;
};
