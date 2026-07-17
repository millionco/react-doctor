// rule: no-cramped-container-padding
// weakness: static-value-guard
// source: bugbot-pr-850

export const InvisibleBoundaries = () => (
  <>
    <span className="border-0 p-1">Zero border</span>
    <span className="border border-transparent p-1">Transparent border</span>
    <span className="ring-0 p-1">Zero ring</span>
    <span className="bg-blue-500 bg-opacity-0 p-1">Transparent background</span>
    <span style={{ borderWidth: 0, padding: 4 }}>Inline zero border</span>
  </>
);
