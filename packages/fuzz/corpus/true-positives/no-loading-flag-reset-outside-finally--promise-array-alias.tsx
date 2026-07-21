// rule: no-loading-flag-reset-outside-finally
// weakness: copy-tracking
// source: parity audit
// verdict: fail

export const SaveButton = () => {
  const [isSaving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const requests = [];
    const pending = requests;
    pending.push(fetch("/save"));
    await Promise.all(requests);
    setSaving(false);
  };

  return <button onClick={save}>{isSaving ? "Saving" : "Save"}</button>;
};
