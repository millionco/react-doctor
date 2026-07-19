// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: PR #1000 final adversarial audit

import { useState } from "react";

interface Analytics {
  track: (value: number) => void;
}

export const NestedReceiver = ({ analytics }: { analytics: Analytics }) => {
  const [, setValue] = useState(0);
  setValue((value) => {
    const box = { analytics };
    box.analytics.track(value);
    return value + 1;
  });
  return null;
};

export const MemberCallback = (props: { onVisit: (value: number) => void }) => {
  const [, setValue] = useState(0);
  setValue((value) => {
    const callbacks = { onVisit: props.onVisit };
    callbacks.onVisit(value);
    return value + 1;
  });
  return null;
};
