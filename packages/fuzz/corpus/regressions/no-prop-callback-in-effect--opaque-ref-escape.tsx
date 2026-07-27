// rule: no-prop-callback-in-effect
// weakness: alias-guard
// source: parent callback provenance review
// verdict: pass

import { useEffect, useRef, useState } from "react";

declare const overwriteRef: (reference: { current: (value: number) => void }) => void;

export const Child = ({ onChange }: { onChange: (value: number) => void }) => {
  const [value] = useState(0);
  const callbackRef = useRef(onChange);
  overwriteRef(callbackRef);
  useEffect(() => callbackRef.current(value), [value]);
  return null;
};
