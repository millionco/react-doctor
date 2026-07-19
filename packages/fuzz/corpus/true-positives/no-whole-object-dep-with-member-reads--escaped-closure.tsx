// rule: no-whole-object-dep-with-member-reads
// weakness: wrapper-transparency
// source: PR #1000 final independent audit

import { useCallback } from "react";

export const EscapedClosure = (props: { value: number }) => {
  return useCallback(() => {
    setTimeout(() => console.log(props.value), 0);
  }, [props]);
};
