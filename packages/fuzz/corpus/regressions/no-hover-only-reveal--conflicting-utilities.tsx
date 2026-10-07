// rule: no-hover-only-reveal
// weakness: utility-cascade
// source: Tailwind utility cascade contract audit
// verdict: pass

export const AmbiguousHoverReveal = () => (
  <>
    <button className="opacity-0 opacity-100 hover:opacity-100">Edit</button>
    <button className="opacity-0 hover:opacity-0 hover:opacity-100">Delete</button>
    <button className="opacity-0 hover:opacity-100 focus:opacity-0 focus:opacity-100">
      Archive
    </button>
  </>
);
