// rule: no-ref-current-in-render
// weakness: unstable-initialization
// source: ReactBench RDFPFN792026 adversarial control

import { useRef } from "react";

interface PanelProps {
  data: Map<string, string>;
}

export const Panel = ({ data }: PanelProps) => {
  const dataRef = useRef<Map<string, string> | null>(null);
  if (dataRef.current === null) dataRef.current = data;
  return null;
};
