// rule: no-decorative-pulse
// weakness: static-spread-aria-busy
// source: synthetic audit regression
export const Panel = () => (
  <span {...{ "aria-busy": true }} className="animate-pulse font-medium">
    Indexing project
  </span>
);
