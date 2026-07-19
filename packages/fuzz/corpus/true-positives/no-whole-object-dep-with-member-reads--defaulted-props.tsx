// rule: no-whole-object-dep-with-member-reads
// weakness: wrapper-transparency
// source: PR #1000 final adversarial audit

import { useMemo } from "react";

interface Props {
  width?: number;
}

export const DefaultedProps = (props: Props = {}) => {
  return useMemo(() => props.width ?? 0, [props]);
};
