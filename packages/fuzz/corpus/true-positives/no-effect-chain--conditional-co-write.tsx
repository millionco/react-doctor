// rule: no-effect-chain
// weakness: control-flow

import { useEffect, useState } from "react";

interface ConditionalCoWriteProps {
  coordinates: object;
}

export const ConditionalCoWrite = ({ coordinates }: ConditionalCoWriteProps) => {
  const [anchor, setAnchor] = useState<object | null>(null);
  const [rangeEnd, setRangeEnd] = useState<object | null>(null);
  const setSelection = (nextCoordinates: object, skipRangeEnd: boolean) => {
    setAnchor(nextCoordinates);
    if (skipRangeEnd) return;
    setRangeEnd(nextCoordinates);
  };

  useEffect(() => setSelection(coordinates, true), [coordinates, setSelection]);
  useEffect(() => {
    if (!anchor || rangeEnd) return;
    setRangeEnd(anchor);
  }, [anchor, rangeEnd]);

  return rangeEnd;
};
