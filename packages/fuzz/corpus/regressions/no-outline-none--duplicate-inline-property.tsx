// rule: no-outline-none
// weakness: control-flow
// source: adversarial parity review
// verdict: pass

export const Button = () => (
  <button style={{ outline: "none", outline: "2px solid red" }}>Save</button>
);
