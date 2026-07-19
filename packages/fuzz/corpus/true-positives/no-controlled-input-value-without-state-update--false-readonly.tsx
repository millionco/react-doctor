// rule: no-controlled-input-value-without-state-update
// weakness: wrapper-transparency
// source: deep audit of millionco/react-doctor#1000

export const Field = () => <input value="fixed" readOnly={false} onChange={submit} />;
