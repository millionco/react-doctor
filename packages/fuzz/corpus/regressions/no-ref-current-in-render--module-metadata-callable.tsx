/* eslint-disable react/refs */
// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic module metadata callback
// verdict: pass

import { useRef } from "react";

type Action = () => string;

export const useModuleMetadata = () => {
  const actionRef = useRef<Action>();
  if (!actionRef.current) actionRef.current = () => import.meta.url;
  return actionRef.current;
};
