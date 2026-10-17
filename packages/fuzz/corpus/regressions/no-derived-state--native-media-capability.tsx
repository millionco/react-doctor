// rule: no-derived-state, no-derived-state-effect, no-adjust-state-on-prop-change
// verdict: pass
// weakness: control-flow
// source: synthetic fresh media capability controls individual state writes
import { useEffect, useState } from "react";

interface MediaCapabilityInput {
  selectedKey: string;
}

export const MediaCapability = ({ selectedKey }: MediaCapabilityInput) => {
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const probe = document.createElement("video");
    const support = probe.canPlayType("video/example");
    if (support === "maybe" || support === "probably") {
      setAcceptedKey(selectedKey);
      setReady(true);
    }
  }, [selectedKey]);
  return <output>{ready ? acceptedKey : null}</output>;
};
