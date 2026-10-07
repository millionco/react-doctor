// rule: no-hover-only-reveal
// weakness: variant-scope
// source: Tailwind CSS named-group documentation
// verdict: fail

export const NestedGroupAction = () => (
  <button className="group/item">
    Item
    <span className="opacity-0 group-hover/item:opacity-100 group-focus-within/other:opacity-100">
      Delete
    </span>
  </button>
);
