// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: PR #1000 deep audit 2026-07
export const SaveButton = () => {
  const [, setLoading] = useState(false);
  const save = async () => {
    setLoading(true);
    try {
      await fetch("/value");
    } catch (error) {
      if (shouldRetry) {
        setLoading(false);
        return;
      }
      setLoading(false);
      throw error;
    }
    setLoading(false);
  };
  return <button onClick={save}>Save</button>;
};
