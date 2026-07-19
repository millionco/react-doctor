// rule: no-whole-object-dep-with-member-reads
// weakness: library-idiom
// source: PR #1000 final independent audit

import { useMemo } from "react";

interface FormatterProps {
  format(): string;
}

export const MethodPanel = (props: FormatterProps) => useMemo(() => props.format(), [props]);
