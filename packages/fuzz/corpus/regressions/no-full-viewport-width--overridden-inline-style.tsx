// rule: no-full-viewport-width
// weakness: last-property-wins
// source: Bugbot review on PR #850
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const ContainedWidth = () => <div style={{ width: "100vw", width: "100%" }} />;
