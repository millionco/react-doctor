// rule: no-whole-object-default-losing-per-key-defaults
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (PortOS finishSession: every in-file call site of the non-escaping local passes the at-risk key explicitly)
export const SessionPanel = ({ onFinish }: { onFinish: (keep: boolean) => void }) => {
  const finishSession = async ({ keep } = { keep: true }) => {
    onFinish(keep);
  };
  return (
    <div>
      <button type="button" onClick={() => finishSession({ keep: true })}>
        Finish
      </button>
      <button type="button" onClick={() => finishSession({ keep: false })}>
        Discard
      </button>
    </div>
  );
};
