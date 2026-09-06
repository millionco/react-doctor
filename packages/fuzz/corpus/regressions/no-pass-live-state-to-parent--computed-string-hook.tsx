// rule: no-pass-live-state-to-parent
// weakness: name-heuristic
// source: Fresh handwritten computed hook name regression
// verdict: pass

import { useEffect } from "react";

interface PreviewProps {
  seed: number;
  onChange: (value: number) => void;
}

declare const cache: { useCache: (value: number) => number };

export const Preview = ({ seed, onChange }: PreviewProps) => {
  const value = cache["useCache"](seed);
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return <div />;
};
