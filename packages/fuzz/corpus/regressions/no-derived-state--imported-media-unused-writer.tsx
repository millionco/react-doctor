// rule: no-derived-state
// verdict: pass
// weakness: cross-file
// source: independent synthetic state without an effect writer
import { useEffect, useState } from "react";
import { supportsClip } from "./synthetic-missing-capability";
export const MediaSelection = ({ mime, source }: { mime: string; source: string }) => {
  const [selected] = useState<string | null>(null);
  const currentMime = mime;
  useEffect(() => {
    if (currentMime && supportsClip(currentMime)) void source;
  }, [currentMime, source]);
  return <output>{selected}</output>;
};
