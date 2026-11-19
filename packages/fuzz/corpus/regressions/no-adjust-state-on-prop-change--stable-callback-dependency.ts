// rule: no-adjust-state-on-prop-change
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import { useCallback, useEffect, useRef, useState } from "react";

export const usePreview = (initialText: string, prefix: string) => {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const prefixRef = useRef(prefix);
  useEffect(() => {
    prefixRef.current = prefix;
  }, [prefix]);

  const run = useCallback((value: string) => {
    setError(null);
    if (value !== prefixRef.current) setError("Invalid input");
  }, []);

  useEffect(() => {
    run(text);
  }, [text, run]);
  return { error, setText };
};
