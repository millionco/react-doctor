// rule: exhaustive-deps
// verdict: safe
import { useState, useMemo } from "react";
interface Props {
  value?: string[];
}
export const View = ({ value }: Props) => {
  const [internal] = useState<string[]>([]);
  const controlled = value !== undefined;
  const selected = controlled ? (value ?? []) : internal;
  return useMemo(() => selected.join(), [selected]);
};
