// rule: no-hover-only-reveal
// weakness: variant-scope
// source: Tailwind utility cascade contract audit
// verdict: fail

export const ScopedHoverAction = () => (
  <button className="dark:opacity-0 dark:hover:opacity-100 focus:opacity-100 dark:focus:opacity-0">
    Edit
  </button>
);
