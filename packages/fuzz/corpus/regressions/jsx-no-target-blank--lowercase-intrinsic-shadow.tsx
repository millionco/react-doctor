// rule: jsx-no-target-blank
// weakness: binding-provenance
// source: PR #1167 Bugbot review
// verdict: pass
export const button = "a" as const;

export const ExternalAction = () => <button target="_blank">Open</button>;
