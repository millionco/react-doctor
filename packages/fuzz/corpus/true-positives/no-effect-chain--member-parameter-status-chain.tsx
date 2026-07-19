// rule: no-effect-chain
// weakness: provenance

import { useEffect, useState } from "react";

interface MemberParameterStatusChainProps {
  source: { key: string };
}

export const MemberParameterStatusChain = ({ source }: MemberParameterStatusChainProps) => {
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("idle");
  const commit = (selection: { key: string }) => setSelected(selection.key);

  useEffect(() => commit(source), [commit, source]);
  useEffect(() => {
    if (selected) setStatus("ready");
  }, [selected]);

  return status;
};
