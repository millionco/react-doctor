// rule: no-cramped-container-padding
// weakness: cascade-ambiguity
// source: PR #1337 deep review

export const PlainLabel = () => <div className="bg-blue-500 bg-transparent p-1">Status</div>;
