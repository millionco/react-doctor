// rule: no-effect-chain
// weakness: value-domain
// source: PR #1322 soundness review

import { useEffect, useState } from "react";

interface Coordinates {
  column: number;
  row: number;
}

interface UnknownCorrelatedRangeWriteProps {
  coordinates: Coordinates | null;
}

export const UnknownCorrelatedRangeWrite = ({ coordinates }: UnknownCorrelatedRangeWriteProps) => {
  const [anchor, setAnchor] = useState<Coordinates | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Coordinates | null>(null);
  const setSingleRange = (nextCoordinates: Coordinates | null) => {
    setAnchor(nextCoordinates);
    setRangeEnd(nextCoordinates);
  };

  useEffect(() => {
    if (coordinates) setSingleRange(coordinates);
  }, [coordinates, setSingleRange]);
  useEffect(() => {
    if (!anchor || rangeEnd) return;
    setRangeEnd(anchor);
  }, [anchor, rangeEnd]);

  return rangeEnd?.row ?? null;
};
