// rule: no-crushed-letter-spacing
// weakness: last-property-wins
// source: Bugbot review on PR #850
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const ComfortableTracking = () => (
  <h1 style={{ letterSpacing: "-0.12em", letterSpacing: "0" }}>Readable heading</h1>
);
