// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525

import { useState } from "react";

const headers = new Headers();
const headerAlias = headers;
const data = new FormData();
const parameters = new URLSearchParams();

export const ExternalPlatformAppend = () => {
  const [, setValue] = useState("");
  setValue((previous) => {
    headerAlias.append("x-value", previous);
    data.append("value", previous);
    parameters.append("value", previous);
    return previous;
  });
  return null;
};
