// rule: rerender-lazy-ref-init
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import * as React from "react";

const createRegistry = () => new Map<string, number>();

export const TypedHookInitializer = () => {
  React.useRef((React as typeof React)["useMemo"](createRegistry, []));
  return null;
};
