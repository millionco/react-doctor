// rule: no-symmetric-text-button-padding
// weakness: library-idiom
// source: saved candidate audit, icon-only button with accessible text
// verdict: pass
export const Filter = () => (
  <button className="p-2">
    <span className="sr-only">Filter</span>
    <FilterIcon />
  </button>
);
