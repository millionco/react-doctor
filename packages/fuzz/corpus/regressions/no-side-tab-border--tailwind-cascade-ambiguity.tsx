// rule: no-side-tab-border
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: pass

export const Borders = () => (
  <>
    <div className="border-l-4 border-l-0 border-red-500" />
    <div className="border-l-4 border-l-red-500 border-l-gray-200" />
    <div className="rounded-lg rounded-none border-t-2 border-red-500" />
    <div className="border-l-4 border-l-red-500 !border-l-gray-200" />
    <div className="border-l-4 border-l-[var(--accent)]" />
  </>
);
