// rule: no-reset-all-state-on-prop-change
// weakness: alias-guard
// source: React Bench Cloudscape focus-lock transition tracker
import { useEffect, useRef, useState } from "react";

interface FocusLockProps {
  disabled?: boolean;
  restoreFocus: boolean;
}

export const FocusLock = ({ disabled, restoreFocus }: FocusLockProps) => {
  const target = useRef<HTMLButtonElement>(null);
  const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));

  useEffect(() => {
    if (previouslyDisabled !== Boolean(disabled)) {
      setPreviouslyDisabled(Boolean(disabled));
      if (restoreFocus && disabled) target.current?.focus();
    }
  }, [previouslyDisabled, disabled, restoreFocus]);

  return (
    <button ref={target} type="button">
      Target
    </button>
  );
};
