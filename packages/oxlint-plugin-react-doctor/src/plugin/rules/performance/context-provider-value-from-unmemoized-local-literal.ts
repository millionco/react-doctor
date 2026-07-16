import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { collectContextBindings } from "../../utils/collect-context-bindings.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isContextProviderJsxName } from "../../utils/is-context-provider-jsx-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — wrap it in useMemo/useCallback (or move it out of the component).";

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
    : findEnclosingFunction(binding.scopeOwner);

// Complements `jsx-no-constructed-context-values` (which fires only when
// the `value` attribute is ITSELF a literal). This rule resolves a
// one-hop identifier bound in the SAME render scope to a fresh
// object/array/function literal — the identifier-indirection form the
// base rule documents as a pass.
//
// React Compiler auto-memoizes the per-render allocation, so consumers
// never see a fresh value on unrelated renders and the recommendation
// (add useMemo) is exactly what compiler codebases forbid — the rule is
// `disabledWhen: ["react-compiler"]`, matching the sibling
// `jsx-no-new-*-as-prop` / `prefer-stable-empty-fallback` gates.
//
// KNOWN ACCEPTED NOISE: a provider that is a comment-documented
// tests/storybook-only stub living in a PRODUCTION file (run-kit's
// `StandaloneSessionContextProvider` in `src/contexts/session-context.tsx`)
// is byte-for-byte the rule's flagship one-hop-literal shape — the only
// signals are a JSDoc comment and its name, neither of which single-file
// AST analysis can honor without also silencing real providers. The
// `test-noise` tag already skips such stubs when they live under
// testlike paths; stubs co-located with production providers stay
// flagged.
export const contextProviderValueFromUnmemoizedLocalLiteral = defineRule({
  id: "context-provider-value-from-unmemoized-local-literal",
  title: "Context value from an unmemoized local literal",
  tags: ["react-jsx-only", "test-noise"],
  severity: "warn",
  category: "Performance",
  disabledWhen: ["react-compiler"],
  recommendation:
    "Wrap the context value in useMemo/useCallback so consumers do not redraw every render, or move it outside the component if it never changes.",
  create: (context: RuleContext) => {
    let contextBindings: ReadonlySet<string> = new Set<string>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        contextBindings = collectContextBindings(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isContextProviderJsxName(node.name, contextBindings)) return;
        // Only a component/hook body re-runs per render AND can host a
        // useMemo. An inline callback (a `.map()` render loop, a
        // `useMemo` factory) is neither: hooks cannot be called there,
        // so the recommendation would be unactionable — bail.
        const renderFunction = findEnclosingFunction(node);
        if (!renderFunction) return;
        if (componentOrHookDisplayNameForFunction(renderFunction) === null) return;

        const attribute = findJsxAttribute(node.attributes, "value");
        if (!attribute) return;
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
      },
    };
  },
});
