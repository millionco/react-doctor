// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 soundness review

import axios from "axios";
import { useEffect, useState } from "react";

interface MutatedProvenReceiverProps {
  source: number;
}

export const MutatedProvenReceiver = ({ source }: MutatedProvenReceiverProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const client = axios.create();
  const clientAlias = client;
  clientAlias.get = () => Promise.resolve({ data: null });

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    void client.get("/rows");
    setTarget(intermediate);
  }, [client, intermediate]);

  return target;
};
