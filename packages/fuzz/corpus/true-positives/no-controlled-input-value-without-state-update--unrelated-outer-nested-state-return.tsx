// rule: no-controlled-input-value-without-state-update
// weakness: control-flow
// source: deep audit of Cursor Bugbot review on millionco/react-doctor#1390

export const Field = ({ draft, setDraft, isEditing }) => {
  if (isEditing) {
    if (draft !== null) {
      return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
    }
  }
  return <input value="fixed" onChange={submit} />;
};
