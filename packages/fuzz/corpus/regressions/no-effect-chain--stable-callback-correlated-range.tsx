// rule: no-effect-chain
// weakness: control-flow
// source: React Bench Medusa DataGrid

import { useCallback, useEffect, useState } from "react";

interface StableCallbackCorrelatedRangeProps {
  coordinates: { column: number; row: number } | null;
}

export const StableCallbackCorrelatedRange = ({
  coordinates,
}: StableCallbackCorrelatedRangeProps) => {
  const [anchor, setAnchor] = useState<{ column: number; row: number } | null>(null);
  const [rangeEnd, setRangeEnd] = useState<{ column: number; row: number } | null>(null);
  const setSingleRange = useCallback((nextCoordinates: { column: number; row: number }) => {
    setAnchor(nextCoordinates);
    setRangeEnd(nextCoordinates);
  }, []);

  useEffect(() => {
    if (!anchor && coordinates) setSingleRange(coordinates);
  }, [anchor, coordinates, setSingleRange]);
  useEffect(() => {
    if (!anchor || rangeEnd) return;
    setRangeEnd(anchor);
  }, [anchor, rangeEnd]);

  return rangeEnd;
};
