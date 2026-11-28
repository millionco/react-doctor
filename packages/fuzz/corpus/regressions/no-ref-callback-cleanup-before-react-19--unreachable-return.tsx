// rule: no-ref-callback-cleanup-before-react-19
// verdict: pass
// weakness: control-flow
// source: synthetic callback ref with a statically disabled branch

export function Panel({ useLegacyCleanup }: { useLegacyCleanup: () => void }) {
  return (
    <div
      ref={(node) => {
        if (node) node.focus();
        // oxlint-disable-next-line no-constant-condition -- intentional unreachable return
        if (false) return () => useLegacyCleanup();
      }}
    />
  );
}
