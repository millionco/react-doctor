// rule: no-effect-chain
// weakness: value-flow
// source: React Bench Medusa paired control

import { useEffect, useState } from "react";

interface RangeCoordinates {
  column: number;
  row: number;
}

interface UncorrelatedRangeWriteProps {
  anchorCoordinates: RangeCoordinates | null;
  rangeCoordinates: RangeCoordinates | null;
}

export const UncorrelatedRangeWrite = ({
  anchorCoordinates,
  rangeCoordinates,
}: UncorrelatedRangeWriteProps) => {
  const [anchor, setAnchor] = useState<RangeCoordinates | null>(null);
  const [rangeEnd, setRangeEnd] = useState<RangeCoordinates | null>(null);
  const setRange = (nextAnchor: RangeCoordinates | null, nextRangeEnd: RangeCoordinates | null) => {
    setAnchor(nextAnchor);
    setRangeEnd(nextRangeEnd);
  };

  useEffect(() => {
    setRange(anchorCoordinates, rangeCoordinates);
  }, [anchorCoordinates, rangeCoordinates, setRange]);
  useEffect(() => {
    if (!anchor || rangeEnd) return;
    setRangeEnd(anchor);
  }, [anchor, rangeEnd]);

  return rangeEnd?.row ?? null;
};
