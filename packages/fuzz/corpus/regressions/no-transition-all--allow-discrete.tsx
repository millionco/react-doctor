// rule: no-transition-all
// weakness: name-heuristic
// source: PR #850 Cursor Bugbot review

export const DiscreteTransition = () => <div style={{ transition: "allow-discrete 200ms" }} />;
