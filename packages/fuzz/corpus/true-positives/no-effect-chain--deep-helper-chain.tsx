// rule: no-effect-chain
// weakness: stack-depth

import { useEffect, useState } from "react";

interface DeepHelperChainProps {
  source: string;
}

export const DeepHelperChain = ({ source }: DeepHelperChainProps) => {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const helper0 = (enabled: boolean) => {
    if (!enabled) return;
    setStatus("ready");
  };
  const helper1 = (enabled: boolean) => helper0(enabled);
  const helper2 = (enabled: boolean) => helper1(enabled);
  const helper3 = (enabled: boolean) => helper2(enabled);
  const helper4 = (enabled: boolean) => helper3(enabled);
  const helper5 = (enabled: boolean) => helper4(enabled);
  const helper6 = (enabled: boolean) => helper5(enabled);
  const helper7 = (enabled: boolean) => helper6(enabled);

  useEffect(() => setActive(true), [source]);
  useEffect(() => helper7(active), [active]);

  return status;
};
