// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: parity audit
// verdict: pass

export const SaveButton = () => {
  const [isSaving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const requests = [];
    const mutateLater = () => requests.push(fetch("/unused"));
    await Promise.all(requests);
    setSaving(false);
  };

  return <button onClick={save}>{isSaving ? "Saving" : "Save"}</button>;
};
