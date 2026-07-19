// rule: no-controlled-input-value-without-state-update
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const FrozenPreview = () => <input onChange={() => false} value="Preview only" />;
