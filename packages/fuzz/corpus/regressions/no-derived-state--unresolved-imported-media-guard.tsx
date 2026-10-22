// rule: no-derived-state
// verdict: fail
// weakness: cross-file
// source: independent synthetic unresolved native provider boundary
import { useEffect, useState } from "react";
import { supportsClip } from "./synthetic-missing-capability";
export const MediaSelection = ({ mime, source }: { mime: string; source: string }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const currentMime = mime;
  useEffect(() => {
    if (currentMime && supportsClip(currentMime)) setSelected(source);
  }, [currentMime, source]);
  return <output>{selected}</output>;
};
