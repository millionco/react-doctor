// rule: no-create-ref-in-function-component
// weakness: library-idiom
// source: internxt/drive-web@3f96ab42f727083a04cbb1e2aef39d232ca730cc

import { createRef, useEffect, useState } from "react";

export const RedirectToApp = () => {
  const [anchorRef] = useState(createRef<HTMLAnchorElement>());

  useEffect(() => {
    anchorRef.current?.click();
  }, [anchorRef]);

  return (
    <a ref={anchorRef} href="inxt://app">
      Open app
    </a>
  );
};
