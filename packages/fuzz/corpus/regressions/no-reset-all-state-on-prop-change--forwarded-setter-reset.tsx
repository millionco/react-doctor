// rule: no-reset-all-state-on-prop-change
// weakness: forwarded-setter
// source: Airflow XCom modal reset through a transparent setter helper
// verdict: fail
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface XComEditorProps {
  isOpen: boolean;
}

export const XComEditor = ({ isOpen }: XComEditorProps) => {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      assign(setKey, "");
      assign(setValue, "");
    }
  }, [isOpen]);

  return (
    <>
      <input onChange={(event) => setKey(event.target.value)} value={key} />
      <textarea onChange={(event) => setValue(event.target.value)} value={value} />
    </>
  );
};
