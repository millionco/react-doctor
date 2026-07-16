// rule: no-effect-chain
// weakness: value-domain

import { useEffect, useState } from "react";

interface NanCorrelatedCoWriteProps {
  source: number;
}

export const NanCorrelatedCoWrite = ({ source }: NanCorrelatedCoWriteProps) => {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  useEffect(() => {
    setAnchor(source);
    setRangeEnd(source);
  }, [source]);
  useEffect(() => {
    if (anchor === rangeEnd) return;
    setStatus(anchor);
  }, [anchor, rangeEnd]);

  return status;
};
