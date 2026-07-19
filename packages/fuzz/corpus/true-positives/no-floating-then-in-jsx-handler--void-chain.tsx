// rule: no-floating-then-in-jsx-handler
// weakness: wrapper-transparency
export const Save = () => <button onClick={() => void save().then(done)}>Save</button>;
