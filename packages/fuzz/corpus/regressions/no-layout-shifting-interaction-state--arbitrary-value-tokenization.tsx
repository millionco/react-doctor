// rule: no-layout-shifting-interaction-state
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const StableAction = () => <button className="before:content-['x hover:px-6']">Save</button>;
