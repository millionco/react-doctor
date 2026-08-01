// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525 adversarial control

import { useState } from "react";

export const LocalSetterMethod = () => {
  const helpers = { setMessages: (messages: string[]) => messages };
  const [, setMessages] = useState<string[]>([]);
  setMessages((previous) => {
    helpers.setMessages(previous);
    return previous;
  });
  return null;
};
