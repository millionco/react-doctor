// rule: no-scale-from-zero
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md / PR #1290

interface PanelProps {
  initial: { scale: number };
}

const Panel = ({ initial }: PanelProps) => <output>{initial.scale}</output>;

export const Example = () => <Panel initial={{ scale: 0 }} />;
