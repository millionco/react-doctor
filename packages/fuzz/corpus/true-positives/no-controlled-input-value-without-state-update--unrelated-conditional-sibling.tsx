// rule: no-controlled-input-value-without-state-update
// weakness: control-flow
// source: Cursor Bugbot review of millionco/react-doctor#1390

export const Field = ({ draft, mode, setDraft }) => {
  if (mode === "preview") {
    return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
  }
  return <input value="fixed" onChange={submit} />;
};
