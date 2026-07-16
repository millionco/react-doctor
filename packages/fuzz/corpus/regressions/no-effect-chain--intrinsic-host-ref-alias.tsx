// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 soundness review

import { useEffect, useRef, useState } from "react";

interface IntrinsicHostRefAliasProps {
  activeId: string;
}

export const IntrinsicHostRefAlias = ({ activeId }: IntrinsicHostRefAliasProps) => {
  const [isMounted, setIsMounted] = useState(false);
  const nodeRef = useRef<HTMLInputElement>(null);
  const nodeAlias = nodeRef;

  useEffect(() => setIsMounted(true), [activeId]);
  useEffect(() => {
    nodeAlias.current?.focus();
  }, [isMounted, nodeAlias]);

  return isMounted ? <input ref={nodeRef} /> : null;
};
