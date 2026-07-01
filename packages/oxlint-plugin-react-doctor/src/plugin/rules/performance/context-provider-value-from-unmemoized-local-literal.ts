import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — wrap it in useMemo/useCallback (or move it out of the component).";

// Modules whose `createContext` has React's identity semantics.
const CONTEXT_MODULES = ["react", "use-context-selector", "react-tracked"];

// Fresh per-render allocations — the literal shapes the revision
// restricts this rule to. A useMemo/useCallback/useRef/useState call
// or member access is none of these, so it is naturally excluded.
const isFreshLiteralInitializer = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "FunctionDeclaration")
  );
};

// Only an UNCONDITIONAL `const/let/var name = <literal>` (or a hoisted
// local `function name() {}`) is a per-render allocation. A parameter
// or destructuring DEFAULT (`function App({ config = {} })`) records
// its default as the initializer, but that value only allocates when
// the source is undefined, and "wrap it in useMemo" is the wrong fix
// for a prop — same contract as no-effect-with-fresh-deps.
const isDirectDeclarationInitializer = (binding: BindingInfo): boolean => {
  const declarationNode = binding.bindingIdentifier.parent;
  if (
    declarationNode &&
    isNodeOfType(declarationNode, "VariableDeclarator") &&
    declarationNode.init === binding.initializer
  ) {
    return true;
  }
  return Boolean(
    binding.initializer &&
    isNodeOfType(binding.initializer, "FunctionDeclaration") &&
    binding.initializer.id === binding.bindingIdentifier,
  );
};

// The function whose body re-runs to rebuild the binding. Block-scoped
// declarations (`if (x) { const value = {...} }`) report the block as
// scopeOwner; walk up to the owning function in that case.
const owningFunctionOfBinding = (binding: BindingInfo): EsTreeNode | null =>
  isFunctionLike(binding.scopeOwner)
    ? binding.scopeOwner
    : nearestEnclosingFunction(binding.scopeOwner);

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
        // Only a component/hook body re-runs per render AND can host a
        // useMemo. An inline callback (a `.map()` render loop, a
        // `useMemo` factory) is neither: hooks cannot be called there,
        // so the recommendation would be unactionable — bail.
        const renderFunction = nearestEnclosingFunction(node);
        if (!renderFunction) return;
        if (componentOrHookDisplayNameForFunction(renderFunction) === null) return;

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
          if (!isDirectDeclarationInitializer(binding)) return;
          // A binding owned by an outer factory/HOC closure is
          // allocated once, not per render of this component.
          if (owningFunctionOfBinding(binding) !== renderFunction) return;
          if (!isFreshLiteralInitializer(binding.initializer)) return;

          context.report({ node: attribute, message: MESSAGE });
          return;
        }
      },
    };
  },
});
