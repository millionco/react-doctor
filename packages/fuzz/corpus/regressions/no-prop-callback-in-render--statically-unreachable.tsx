// rule: no-prop-callback-in-render
// verdict: pass
// weakness: control-flow
// source: synthetic callback inside an unreachable condition

export function Panel({ onReady }: { onReady: () => void }) {
  // oxlint-disable-next-line no-constant-condition -- The unreachable branch is the regression input.
  if (false) onReady();
  return <div />;
}
