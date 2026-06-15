import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactFunctionCall } from "../../utils/is-react-function-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MESSAGE =
  "`createRef()` in a function component allocates a brand-new ref on every render, so it never holds a value between renders. Use the `useRef()` hook instead.";

// `createRef` is the class-component ref API. Inside a function component or a
// custom hook it produces a fresh ref each render (no persistence) — almost
// always a bug; `useRef` is the correct API. We require strong evidence that
// the enclosing function is really a component/hook: a `use*` name (hook) or a
// PascalCase function that returns JSX (component). A PascalCase *factory*
// (`function MakeThing() { return createRef() }`) returns no JSX and is left
// alone. Class methods, class fields, and module scope resolve to no enclosing
// component and stay quiet too.
export const noCreateRefInFunctionComponent = defineRule({
  id: "no-create-ref-in-function-component",
  title: "createRef in function component",
  severity: "warn",
  recommendation:
    "Replace `createRef()` with the `useRef()` hook inside function components and hooks. `createRef` is only for class components.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactFunctionCall(node, "createRef")) return;

      // Guard the bare `createRef()` form against a shadowing local binding
      // (`const createRef = () => ({})`). If the identifier resolves to a
      // non-import declaration it isn't React's `createRef`, so skip.
      if (isNodeOfType(node.callee, "Identifier")) {
        const symbol = context.scopes.symbolFor(node.callee);
        if (symbol && symbol.kind !== "import") return;
      }

      const enclosingFunction = nearestEnclosingFunction(node);
      if (!enclosingFunction) return;
      const displayName = componentOrHookDisplayNameForFunction(enclosingFunction);
      if (!displayName) return;

      // A hook (`use*`) is enough; a PascalCase name must also return JSX to
      // count as a component (filters PascalCase factories).
      const isComponentOrHook =
        isReactHookName(displayName) ||
        functionContainsReactRenderOutput(enclosingFunction, context.scopes);
      if (!isComponentOrHook) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
