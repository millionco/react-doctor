// rule: forwarded-set-state-in-effect
// weakness: forwarded-setter
// source: Airflow XCom modal resets its draft value through a transparent setter helper when it opens
// verdict: fail
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface XcomModalProps {
  isOpen: boolean;
  initialValue: string;
}

export const XcomModal = ({ isOpen, initialValue }: XcomModalProps) => {
  const [draftValue, setDraftValue] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      assign(setDraftValue, initialValue);
    }
  }, [isOpen, initialValue]);

  return <textarea readOnly value={draftValue} />;
};
