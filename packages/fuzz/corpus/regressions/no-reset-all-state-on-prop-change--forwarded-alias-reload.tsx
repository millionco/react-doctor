// rule: no-reset-all-state-on-prop-change
// weakness: alias-guard
// source: independent immutable setter aliases retain an asynchronous reload
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

interface EditorProps {
  recordId: string;
}

export const Editor = ({ recordId }: EditorProps) => {
  const [draft, setDraft] = useState("");
  const resetDraft = setDraft;
  const reloadDraft = setDraft;
  useEffect(() => {
    assign(resetDraft, "");
    Promise.resolve(recordId).then((value) => assign(reloadDraft, value));
  }, [recordId, resetDraft, reloadDraft]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
