import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isCreateContextCall } from "../../utils/is-create-context-call.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "createContext() builds a new context every render, so every consumer gets cut off & resets.";

// `createContext()` is identity-keyed: Provider/Consumer pairs match by
// the exact Context object they were given. Calling it inside a render
// function or hook produces a fresh Context object on every render,
// which silently disconnects every consumer from its provider. This is
// both a correctness bug (consumers always fall back to the default
// value) and a perf bug (entire subtree re-renders). React's
// documentation explicitly calls this out: createContext belongs at
// module scope.
//
// Detection (v1):
//   - `createContext(...)` named-imported (including renamed) from "react"
//   - `React.createContext(...)` via the canonical namespace import
//   - Reports only when the call is inside a function whose name looks
//     like a React component (PascalCase) or hook (`use*`). Calls inside
//     plain helper functions or at module scope are left alone.
export const noCreateContextInRender = defineRule({
  id: "no-create-context-in-render",
  title: "createContext called during render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Move `createContext(...)` outside the component, to the top level of the file, so it stays the same on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateContextCall(node, context.scopes)) return;
      const componentOrHookName = enclosingComponentOrHookName(node);
      if (!componentOrHookName) return;
      context.report({
        node,
        message: `${MESSAGE} (called inside "${componentOrHookName}")`,
      });
    },
  }),
});
