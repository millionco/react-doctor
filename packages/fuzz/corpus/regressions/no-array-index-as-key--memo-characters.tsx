// rule: no-array-index-as-key
// weakness: wrapper-transparency
// source: synthetic memoized character projection
// verdict: pass
import { useMemo } from "react";

interface CaptionProps {
  label: string;
}

export const Caption = ({ label }: CaptionProps) => {
  const letters = useMemo(() => Array.from(label), [label]);
  return letters.map((letter, index) => <Glyph key={index} value={letter} />);
};
