// rule: no-inert-pointer-affordance
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: pass

export const Status = () => <span className="cursor-default cursor-pointer">Ready</span>;
