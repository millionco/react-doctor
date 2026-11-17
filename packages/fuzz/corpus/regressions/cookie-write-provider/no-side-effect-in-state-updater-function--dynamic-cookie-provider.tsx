// rule: no-side-effect-in-state-updater-function
// file-path: corpus/regressions/cookie-write-provider/no-side-effect-in-state-updater-function--dynamic-cookie-provider.tsx
// verdict: pass
// weakness: alias-guard
// source: synthetic

import { useState } from "react";
import { setCookie as applyCookie } from "./persist";

export const CookiePreference = () => {
  const [value, setValue] = useState(0);
  return (
    <button
      onClick={() =>
        setValue((previous) => {
          applyCookie("view=compact");
          return previous + 1;
        })
      }
    >
      {value}
    </button>
  );
};
