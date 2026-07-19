// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 soundness review

import { useEffect, useState } from "react";

interface NestedExternalModulePathProps {
  source: number;
}

export const NestedExternalModulePath = ({ source }: NestedExternalModulePathProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const timers = require("node:timers");

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    timers.custom.setTimeout(() => undefined, 0);
    setTarget(intermediate);
  }, [intermediate, timers.custom]);

  return target;
};
