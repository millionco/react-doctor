// rule: no-whole-object-dep-with-member-reads
// weakness: destructuring
// source: PR #1000 final precision review

import { useMemo } from "react";

export const Panel = (props: { user: { name: string } }) => {
  const {
    user: { name },
  } = props;
  return useMemo(() => name.toUpperCase(), [props]);
};
