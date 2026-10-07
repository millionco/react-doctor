// rule: no-loading-flag-reset-outside-finally
// weakness: promise-chain
// source: parity audit
// verdict: fail

export const SaveButton = () => {
  const [isSaving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/save").catch(() => {
      mayThrow();
      return null;
    });
    setSaving(false);
  };

  return <button onClick={save}>{isSaving ? "Saving" : "Save"}</button>;
};
