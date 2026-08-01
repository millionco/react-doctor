// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525

import { useState } from "react";

export const LocalPlatformAppend = () => {
  const [, setValue] = useState("");
  setValue((previous) => {
    const headers = new Headers();
    const headerAlias = headers;
    headerAlias.append("x-value", previous);
    const data = new FormData();
    data.append("value", previous);
    const parameters = new URLSearchParams();
    parameters.append("value", previous);
    new Headers().append("x-direct", previous);
    return parameters.toString();
  });
  return null;
};
