// Types for `react-devtools-inline/backend`, which ships Flow source with no
// TypeScript types. Wired in via tsconfig `paths`. We only use `initialize`,
// which installs the DevTools hook; the renderer attaches itself to the hook
// when React loads, and we drive that renderer interface directly.
export const initialize: (windowOrGlobal: unknown) => void;
