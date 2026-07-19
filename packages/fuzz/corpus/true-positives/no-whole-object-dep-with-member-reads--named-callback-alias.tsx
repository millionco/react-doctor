// rule: no-whole-object-dep-with-member-reads
// weakness: alias-guard
// source: PR #1000 deep precision review

import { useMemo } from "react";

export const MemoPanel = (props: { label: string }) => {
  const readLabel = () => props.label;
  const selectLabel = readLabel;
  return useMemo(selectLabel, [props]);
};
