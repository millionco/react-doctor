import { defineRule } from "../../utils/define-rule.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "createContext() builds a new context every render, so every consumer gets cut off & resets.";

// Context-providing modules whose `createContext` export has the same
// identity-stability semantics as React's. Calling any of these inside
// a render function disconnects every Provider/Consumer pair on the
// next render. Add new entries here as they appear in the ecosystem.
const CONTEXT_MODULES: ReadonlyArray<string> = ["react", "use-context-selector", "react-tracked"];

const getSupportedContextImportSource = (symbol: SymbolDescriptor | null): string | null => {
  if (symbol?.kind !== "import") return null;
  const importDeclaration = symbol.declarationNode.parent;
  if (
    !importDeclaration ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    typeof importDeclaration.source.value !== "string" ||
    !CONTEXT_MODULES.includes(importDeclaration.source.value)
  ) {
    return null;
  }
  return importDeclaration.source.value;
};

const isSupportedNamespaceSymbol = (symbol: SymbolDescriptor | null): boolean =>
  getSupportedContextImportSource(symbol) !== null &&
  Boolean(
    symbol &&
    (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")),
  );

const isDestructuredCreateContextBinding = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(symbol.declarationNode.id, "ObjectPattern")
  ) {
    return false;
  }
  const property = symbol.bindingIdentifier.parent;
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    getStaticPropertyKeyName(property, { allowComputedString: true }) !== "createContext"
  ) {
    return false;
  }
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "Identifier") &&
    isSupportedNamespaceSymbol(resolveConstIdentifierAlias(initializer, scopes))
  );
};

const isCreateContextCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (isDestructuredCreateContextBinding(callee, scopes)) return true;
    const symbol = resolveConstIdentifierAlias(callee, scopes);
    return (
      getSupportedContextImportSource(symbol) !== null &&
      Boolean(symbol && getImportedName(symbol.declarationNode) === "createContext")
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName =
    getCallMethodName(callee) ??
    (callee.computed &&
    isNodeOfType(callee.property, "Literal") &&
    typeof callee.property.value === "string"
      ? callee.property.value
      : null);
  if (methodName !== "createContext") return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (receiver.name === "React" && scopes.isGlobalReference(receiver)) return true;
  return isSupportedNamespaceSymbol(resolveConstIdentifierAlias(receiver, scopes));
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
