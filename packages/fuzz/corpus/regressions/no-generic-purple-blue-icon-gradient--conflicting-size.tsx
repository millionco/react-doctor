// rule: no-generic-purple-blue-icon-gradient
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: pass

export const Icon = () => (
  <span className="size-12 size-8 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex" />
);
