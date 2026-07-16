// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 ship review

import axios from "axios";
import { useEffect, useState } from "react";

const userlandRequest = () => Promise.resolve({ data: null });
({ get: axios.get } = { get: userlandRequest });
[axios.post] = [userlandRequest];

interface DestructuringReceiverMutationProps {
  source: number;
}

export const DestructuringReceiverMutation = ({ source }: DestructuringReceiverMutationProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    void axios.get("/rows");
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};
