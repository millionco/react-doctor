// rule: rerender-memo-with-default-value
// weakness: cross-file
// source: synthetic imported plain class member projection
// verdict: pass
// file-path: corpus/regressions/imported-plain-class-member-projection/entry.tsx
import Child from "./child.jsx";

export const App = ({ config = {} }) => <Child config={config} />;
