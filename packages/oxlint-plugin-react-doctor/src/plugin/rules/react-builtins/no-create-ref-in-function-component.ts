import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isCreateRefResultWriteOnly } from "./is-create-ref-result-write-only.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MESSAGE =
  "`createRef()` may escape or be observed beyond the render that created it, so a later render can replace the ref object and detach the observed one. Hoist a `useRef()` call to the component's unconditional top level instead.";

// `useMemo(() => createRef(), [])` runs its callback during the enclosing
// component/hook's render, so the memo callback is transparent when
// resolving where the createRef really lives — the fix is still `useRef`.
const isUseMemoCallbackArgument = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (parent.arguments?.[0] !== functionNode) return false;
  return isReactApiCall(parent, "useMemo", scopes, { resolveNamedAliases: true });
};

const findEnclosingRenderFunction = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let enclosingFunction = findEnclosingFunction(node);
  while (enclosingFunction && isUseMemoCallbackArgument(enclosingFunction, scopes)) {
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return enclosingFunction;
};

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
      if (
        !isReactApiCall(node, "createRef", context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveNamedAliases: true,
        })
      ) {
        return;
      }

      const enclosingFunction = findEnclosingRenderFunction(node, context.scopes);
      if (!enclosingFunction) return;
      const displayName = componentOrHookDisplayNameForFunction(enclosingFunction);
      if (!displayName) return;

      // A hook (`use*`) is enough; a PascalCase name must also return JSX to
      // count as a component (filters PascalCase factories).
      const isComponentOrHook =
        isReactHookName(displayName) ||
        functionContainsReactRenderOutput(enclosingFunction, context.scopes, context.cfg);
      if (!isComponentOrHook) return;
      if (isCreateRefResultWriteOnly(node, context.filename, context.scopes)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
