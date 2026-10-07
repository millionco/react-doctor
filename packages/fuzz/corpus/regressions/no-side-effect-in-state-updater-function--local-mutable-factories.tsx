// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525

import { useState } from "react";

export const LocalMutableFactories = () => {
  const [, setValue] = useState(0);
  setValue((previous) => {
    const date = new Date(previous);
    date.setTime(previous);
    const view = new DataView(new ArrayBuffer(8));
    view.setUint8(0, previous);
    const bytes = new Uint8Array(8);
    bytes.set([previous]);
    let draft: Map<string, number> | undefined;
    const next = (draft ??= new Map());
    next.set("value", previous);
    const createDraft = () => new Map<string, number>();
    createDraft().set("other", previous);
    return previous + 1;
  });
  return null;
};
