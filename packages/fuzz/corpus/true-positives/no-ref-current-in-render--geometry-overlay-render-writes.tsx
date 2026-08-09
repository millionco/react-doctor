// rule: no-ref-current-in-render
// verdict: fail
// weakness: control-flow
// source: React Bench GeometryOverlay representative trial 2PqCAFU

import { useRef } from "react";

interface Inputs {
  hasGeometry: boolean;
  nodeId: string;
  status?: "running" | "failed";
}

export const GeometryOverlay = ({ nodeId, hasGeometry, status }: Inputs) => {
  const inputs: Inputs = { nodeId, hasGeometry, status };
  const inputsRef = useRef(inputs);
  const versionRef = useRef(0);
  const previous = inputsRef.current;

  if (
    previous.nodeId !== inputs.nodeId ||
    previous.status !== inputs.status ||
    previous.hasGeometry !== inputs.hasGeometry
  ) {
    inputsRef.current = inputs;
    versionRef.current += 1;
  }

  return versionRef.current;
};
