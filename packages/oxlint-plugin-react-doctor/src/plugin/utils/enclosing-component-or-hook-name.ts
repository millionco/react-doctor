import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";

// Returns the name of the React component / hook that DIRECTLY encloses
// `node` — i.e. the nearest enclosing function is itself the component
// or hook — or null otherwise.
//
// Because it stops at the first function boundary, a call nested inside
// an event handler, effect callback, or memo / useMemo callback is NOT
// attributed to the outer component: those bodies don't run on every
// render, so `const onNew = () => { createStore() }` inside `App` is
// correctly left alone.
//
// Component/hook detection (via `componentOrHookDisplayNameForFunction`)
// covers `function App() {}`, `const App = () => {}`,
// `const useFoo = function () {}`, named `memo(function App(){})`, and
// HOC-wrapped `const App = memo(() => {})` / `forwardRef(...)`.
//
// Used by rules that fire only on calls inside render scope —
// `no-create-context-in-render` and `no-create-store-in-render`.
export const enclosingComponentOrHookName = (node: EsTreeNode): string | null => {
  const functionNode = nearestEnclosingFunction(node);
  return functionNode ? componentOrHookDisplayNameForFunction(functionNode) : null;
};
