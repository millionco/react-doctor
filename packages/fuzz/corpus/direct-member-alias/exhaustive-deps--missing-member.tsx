// rule: exhaustive-deps
// verdict: fail
// weakness: alias-guard
// source: invented synthetic control
import { useMemo } from "react";
const readLabels = (source) => source.labels;
export const Panel = ({ settings }) => {
  const labelsSnapshot = settings.other;
  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);
  return selected;
};
