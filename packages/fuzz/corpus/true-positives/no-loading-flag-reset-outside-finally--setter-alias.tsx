// rule: no-loading-flag-reset-outside-finally
// weakness: alias-guard
// source: parity audit
// verdict: fail

export const SaveButton = () => {
  const [isSaving, setSaving] = useState(false);
  const clear = setSaving;

  const save = async () => {
    setSaving(true);
    await persist();
    clear(false);
  };

  return <button onClick={save}>{isSaving ? "Saving" : "Save"}</button>;
};
