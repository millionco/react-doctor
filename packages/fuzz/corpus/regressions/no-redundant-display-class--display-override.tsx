// rule: no-redundant-display-class
// weakness: domain-semantics
// source: PR #850 Cursor Bugbot review

export const DisplayOverride = () => <div className="flex block" />;
