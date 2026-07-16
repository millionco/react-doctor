// rule: no-effect-chain
// weakness: wrapper-transparency
// source: PR #1322 ship review

import axios from "axios";
import { useEffect, useState } from "react";

(axios.defaults as unknown as { adapter: () => void }).adapter = () => undefined;
(axios.defaults satisfies typeof axios.defaults).timeout++;
axios.defaults!.transformRequest = () => undefined;

interface WrappedNestedReceiverMutationProps {
  source: number;
}

export const WrappedNestedReceiverMutation = ({ source }: WrappedNestedReceiverMutationProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    axios.get("/rows");
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};
