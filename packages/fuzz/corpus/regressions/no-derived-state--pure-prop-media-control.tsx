// rule: no-derived-state, no-derived-state-effect, no-adjust-state-on-prop-change
// verdict: fail
// weakness: control-flow
// source: synthetic pure prop guard retains independent mirror and flag warnings
import { useEffect, useState } from "react";

interface MediaMirrorInput {
  selectedKey: string;
  enabled: boolean;
}

export const MediaMirror = ({ selectedKey, enabled }: MediaMirrorInput) => {
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (enabled) {
      setAcceptedKey(selectedKey);
      setReady(true);
    }
  }, [selectedKey, enabled]);
  return <output>{ready ? acceptedKey : null}</output>;
};
