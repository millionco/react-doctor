// rule: exhaustive-deps
// weakness: dynamic-computed
// source: invented fixed numeric slot dependency control
import { useMemo } from "react";

interface SlotValuesProps {
  choices: readonly string[];
}

export const SlotValues = ({ choices }: SlotValuesProps) =>
  useMemo(() => choices[0] + choices[1], [choices[0], choices[1]]);
