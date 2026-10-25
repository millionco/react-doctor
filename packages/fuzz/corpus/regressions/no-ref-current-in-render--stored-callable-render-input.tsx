/* eslint-disable react/refs */
// rule: no-ref-current-in-render
// weakness: copy-tracking
// source: synthetic render-input capture
// verdict: fail

import { useRef } from "react";

type Action = () => number;

export const useCachedAction = (value: number) => {
  const actionRef = useRef<Action>();
  if (!actionRef.current) actionRef.current = () => value;
  return actionRef.current;
};
