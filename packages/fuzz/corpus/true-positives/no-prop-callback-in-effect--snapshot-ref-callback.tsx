// rule: no-prop-callback-in-effect
// weakness: copy-tracking
// source: parent callback provenance review
// verdict: fail

import { useEffect, useRef, useState } from "react";

export const Child = ({ onChange }: { onChange: (value: number) => void }) => {
  const [value] = useState(0);
  const callbackRef = useRef(onChange);
  const notify = callbackRef.current;
  callbackRef.current = console.log;
  useEffect(() => notify(value), [notify, value]);
  return null;
};
