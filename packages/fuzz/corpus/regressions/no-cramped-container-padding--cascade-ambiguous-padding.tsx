// rule: no-cramped-container-padding
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const AmbiguousPadding = () => <div className="border p-1 p-4">Status</div>;
