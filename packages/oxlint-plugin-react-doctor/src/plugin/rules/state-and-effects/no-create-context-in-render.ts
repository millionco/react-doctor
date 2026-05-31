import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isImportedFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "createContext() builds a new context every render, so every consumer gets cut off & resets.";

// Context-providing modules whose `createContext` export has the same
// identity-stability semantics as React's. Calling any of these inside
// a render function disconnects every Provider/Consumer pair on the
// next render. Add new entries here as they appear in the ecosystem.
const CONTEXT_MODULES: ReadonlyArray<string> = ["react", "use-context-selector", "react-tracked"];

const isCreateContextCallee = (callee: EsTreeNode): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    // Resolve through any renamed import — `getImportedNameFromModule`
    // returns the originally-exported symbol name, so we catch both
    // `import { createContext } from "react"` and
    // `import { createContext as makeCtx } from "react"`. We accept
    // any module in `CONTEXT_MODULES`.
    for (const moduleName of CONTEXT_MODULES) {
      const canonicalName = getImportedNameFromModule(callee, callee.name, moduleName);
      if (canonicalName === "createContext") return true;
    }
    return false;
  }

  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const namespaceIdentifier = callee.object;
    const propertyIdentifier = callee.property;
    if (!isNodeOfType(namespaceIdentifier, "Identifier")) return false;
    if (!isNodeOfType(propertyIdentifier, "Identifier")) return false;
    if (propertyIdentifier.name !== "createContext") return false;
    const namespaceName = namespaceIdentifier.name;
    if (isCanonicalReactNamespaceName(namespaceName)) return true;
    for (const moduleName of CONTEXT_MODULES) {
      if (isImportedFromModule(namespaceIdentifier, namespaceName, moduleName)) return true;
    }
    return false;
  }

  return false;
};

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
export const noCreateContextInRender = defineRule<Rule>({
  id: "no-create-context-in-render",
  title: "createContext called during render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Move `createContext(...)` outside the component, to the top level of the file, so it stays the same on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateContextCallee(node.callee)) return;
      const componentOrHookName = enclosingComponentOrHookName(node);
      if (!componentOrHookName) return;
      context.report({
        node,
        message: `${MESSAGE} (called inside "${componentOrHookName}")`,
      });
    },
  }),
});
