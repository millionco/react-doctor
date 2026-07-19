// rule: no-async-event-handler-without-reentry-guard
// weakness: control-flow
// source: PR #1000 deep audit 2026-07
export const ConditionalSave = ({ shouldPost }: { shouldPost: boolean }) => {
  const [, setSaved] = useState(false);
  return (
    <button onClick={async () => (shouldPost ? await api.post() : setSaved(true))}>Save</button>
  );
};
