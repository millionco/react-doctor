// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: PR #1000 final independent audit

import { useState } from "react";

export const MemberCallback = (props: { onVisit: (value: number) => void }) => {
  const [, setRows] = useState<number[]>([]);
  setRows((rows) => {
    rows.forEach(props.onVisit);
    return rows;
  });
  return null;
};
