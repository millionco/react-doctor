// rule: no-reset-all-state-on-prop-change
// weakness: alias-guard
// source: two aliases reset one state while another state remains untouched
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

interface EditorProps {
  recordId: string;
}

export const Editor = ({ recordId }: EditorProps) => {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const first = setDraft;
  const second = setDraft;
  useEffect(() => {
    assign(first, "");
    assign(second, "");
  }, [recordId, first, second]);
  return (
    <>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <input value={note} onChange={(event) => setNote(event.target.value)} />
    </>
  );
};
