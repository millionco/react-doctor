// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 AppFlowy paired control

import { useEffect, useState } from "react";

interface DirectLocalHelperStateWriteProps {
  source: string;
}

export const DirectLocalHelperStateWrite = ({ source }: DirectLocalHelperStateWriteProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const copyIntermediate = () => setIntermediate(source);

  useEffect(() => copyIntermediate(), [source]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
