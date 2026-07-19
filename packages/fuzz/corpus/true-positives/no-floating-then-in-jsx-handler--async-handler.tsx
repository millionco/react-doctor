// rule: no-floating-then-in-jsx-handler
// weakness: control-flow
export const Save = () => <button onClick={async () => save().then(done)}>Save</button>;
