// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: Cursor Bugbot PR #1525

import { useState } from "react";

export const LocalPlatformBuilders = () => {
  const [, setValue] = useState("");
  setValue((previous) => {
    const parameters = new URLSearchParams();
    parameters.set("value", previous);
    const headers = new Headers();
    headers.set("x-value", previous);
    const data = new FormData();
    data.set("value", previous);
    return parameters.toString();
  });
  return null;
};
