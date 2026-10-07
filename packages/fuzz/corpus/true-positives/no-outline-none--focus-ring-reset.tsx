// rule: no-outline-none
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: fail

export const Action = () => (
  <button className="focus:ring-2 focus:!ring-0" style={{ outline: "none" }}>
    Save
  </button>
);
