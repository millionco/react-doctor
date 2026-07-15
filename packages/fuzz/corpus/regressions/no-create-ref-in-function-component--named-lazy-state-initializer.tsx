// rule: no-create-ref-in-function-component
// weakness: name-heuristic
// source: PR #1309 adversarial review

import { createRef, useState } from "react";

const useInitialAnchorRef = () => createRef<HTMLAnchorElement>();

export const RedirectToApp = () => {
  const [anchorRef] = useState(useInitialAnchorRef);

  return (
    <a ref={anchorRef} href="inxt://app">
      Open app
    </a>
  );
};
