// rule: no-derived-state
// weakness: library-idiom
// source: react-bench Rad UI sticky-value and FloatingSheet latest-value adjudication

import { useEffect, useRef } from "react";

const useStickyValue = <Value,>(value: Value | null): Value | null => {
  const lastNonEmptyValue = useRef(value);
  if (value !== null) {
    lastNonEmptyValue.current = value;
  }
  return lastNonEmptyValue.current;
};

export const LatestHeight = ({ height }: { height: number }) => {
  const heightRef = useRef(height);
  heightRef.current = height;

  useEffect(() => {
    readHeight(heightRef.current);
  }, []);

  return useStickyValue(height);
};

declare const readHeight: (height: number) => void;
