// rule: no-hover-only-reveal
// weakness: control-flow
// source: saved candidate audit, keyboard-reachable group action
// verdict: pass

export const Actions = () => (
  <button className="opacity-0 group-hover:opacity-100 focus:opacity-100">Edit</button>
);
