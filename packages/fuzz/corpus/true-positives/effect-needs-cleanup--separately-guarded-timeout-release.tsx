// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1394 Bugbot review — same-block CFG identity hid a separately guarded release

import { useEffect, useRef } from "react";

interface DeferredCommitProps {
  shouldRelease: boolean;
  value: string;
}

export const DeferredCommit = ({ shouldRelease, value }: DeferredCommitProps) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (shouldRelease) clearTimeout(timeoutRef.current ?? undefined);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [shouldRelease, value]);

  useEffect(() => () => clearTimeout(timeoutRef.current ?? undefined), []);

  return null;
};
