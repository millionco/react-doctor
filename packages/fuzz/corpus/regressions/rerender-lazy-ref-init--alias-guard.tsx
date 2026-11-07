// rule: rerender-lazy-ref-init
// verdict: pass
// weakness: alias-guard
// source: authored React Hook alias regression

import * as React from "react";
import { useMemo as memo, useRef } from "react";

const buildIndex = () => new Map<string, number>();

export const HookInitializers = () => {
  const named = useRef(memo(buildIndex, []));
  const computed = React.useRef(React["useMemo"](buildIndex, []));

  return <output>{named.current.size + computed.current.size}</output>;
};
