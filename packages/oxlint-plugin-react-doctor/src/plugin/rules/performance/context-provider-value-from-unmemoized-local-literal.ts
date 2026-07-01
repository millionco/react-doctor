import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — wrap it in useMemo/useCallback (or move it out of the component).";

// Modules whose `createContext` has React's identity semantics.
const CONTEXT_MODULES = ["react", "use-context-selector", "react-tracked"];

// Fresh per-render allocations — the four literal shapes the revision
// restricts this rule to. A useMemo/useCallback/useRef/useState call,
// member access, or destructured prop is none of these, so it is
// naturally excluded.
const isFreshLiteralInitializer = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  );
};

const isCreateContextCall = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const callee = stripped.callee;
  if (isNodeOfType(callee, "Identifier")) {
    return CONTEXT_MODULES.some(
      (moduleName) =>
        getImportedNameFromModule(callee, callee.name, moduleName) === "createContext",
    );
  }
  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const namespaceIdentifier = callee.object;
    if (!isNodeOfType(namespaceIdentifier, "Identifier")) return false;
    if (!isNodeOfType(callee.property, "Identifier")) return false;
    if (callee.property.name !== "createContext") return false;
    if (isCanonicalReactNamespaceName(namespaceIdentifier.name)) return true;
    return CONTEXT_MODULES.some(
      (moduleName) =>
        getImportedNameFromModule(namespaceIdentifier, namespaceIdentifier.name, moduleName) !==
        null,
    );
  }
  return false;
};

// Top-level `const X = createContext(...)` binding names, used to detect
// the React 19 `<X value={…}>` provider shorthand.
const collectContextBindings = (programRoot: EsTreeNode): Set<string> => {
  const bindings = new Set<string>();
  if (!isNodeOfType(programRoot, "Program")) return bindings;
  for (const topLevel of programRoot.body ?? []) {
    let declaration: EsTreeNode | null = topLevel;
    if (isNodeOfType(topLevel, "ExportNamedDeclaration") && topLevel.declaration) {
      declaration = topLevel.declaration;
    }
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) continue;
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init || !isAstNode(declarator.init)) continue;
      if (!isCreateContextCall(declarator.init)) continue;
      bindings.add(declarator.id.name);
    }
  }
  return bindings;
};

const isLegacyProviderName = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXMemberExpression") &&
  isNodeOfType(node.property, "JSXIdentifier") &&
  node.property.name === "Provider";

const isContextShorthandName = (
  node: EsTreeNode,
  contextBindings: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(node, "JSXIdentifier")) return false;
  if (!contextBindings.has(node.name)) return false;
  const binding = findVariableInitializer(node, node.name);
  return binding?.scopeOwner.type === "Program";
};

// Complements `jsx-no-constructed-context-values` (which fires only when
// the `value` attribute is ITSELF a literal). This rule resolves a
// one-hop identifier bound in the SAME render scope to a fresh
// object/array/function literal — the identifier-indirection form the
// base rule documents as a pass.
export const contextProviderValueFromUnmemoizedLocalLiteral = defineRule({
  id: "context-provider-value-from-unmemoized-local-literal",
  title: "Context value from an unmemoized local literal",
  tags: ["react-jsx-only", "test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap the context value in useMemo/useCallback so consumers do not redraw every render, or move it outside the component if it never changes.",
  create: (context: RuleContext) => {
    let contextBindings: ReadonlySet<string> = new Set<string>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        contextBindings = collectContextBindings(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const nameNode = node.name;
        if (!isLegacyProviderName(nameNode) && !isContextShorthandName(nameNode, contextBindings)) {
          return;
        }
        if (!isInsideFunctionScope(node)) return;

        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          if (attribute.name.name !== "value") continue;
          const attributeValue = attribute.value;
          if (!attributeValue || !isNodeOfType(attributeValue, "JSXExpressionContainer")) return;
          const inner = stripParenExpression(attributeValue.expression);
          if (!isNodeOfType(inner, "Identifier")) return;

          const binding = findVariableInitializer(inner, inner.name);
          if (!binding || !binding.initializer) return;
          // Module-scope literals are stable; only render-local
          // declarations are rebuilt each render.
          if (binding.scopeOwner.type === "Program") return;
          if (!isFreshLiteralInitializer(binding.initializer)) return;

          context.report({ node: attribute, message: MESSAGE });
          return;
        }
      },
    };
  },
});
