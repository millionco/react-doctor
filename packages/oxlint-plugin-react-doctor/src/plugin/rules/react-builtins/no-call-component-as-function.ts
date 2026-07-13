import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

const message = (name: string): string =>
  `\`${name}\` is a component, so calling it as a plain function (\`${name}(...)\`) runs it outside React: its hooks break, it gets no fiber/state, and memoization is lost. Render it as \`<${name} />\` instead.`;

// True when the binding the call resolves to is a same-file component
// definition whose body returns JSX. Resolving through the SYMBOL (not the
// name) makes this shadow-safe: a parameter or local named like a component
// resolves to its own binding, not the component, so it is never flagged.
const symbolIsLocalComponent = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const declaration = symbol.declarationNode;
  if (isComponentDeclaration(declaration)) {
    return functionContainsReactRenderOutput(declaration, context.scopes, context.cfg);
  }
  if (isComponentAssignment(declaration) && symbol.initializer) {
    return functionContainsReactRenderOutput(symbol.initializer, context.scopes, context.cfg);
  }
  return false;
};

// True when `declaration` lives at module scope (no enclosing
// function). A PascalCase arrow defined INSIDE a parent component and
// only ever called as `Name()` (never `<Name/>`) is a render helper
// that closes over the parent's hooks — calling it inline is correct,
// and rendering it as JSX would break those closed-over reads.
const isModuleScopeDeclaration = (declaration: EsTreeNode | null | undefined): boolean => {
  let current: EsTreeNode | null | undefined = declaration?.parent;
  while (current) {
    if (isFunctionLike(current)) return false;
    current = current.parent ?? null;
  }
  return true;
};

// A nested render helper that OWNS hooks is not exempt: calling it as
// `Name()` inlines its hooks into the caller's hook order, so a
// conditional call is exactly the hooks-order hazard the rule warns
// about. Only hook-free nested helpers get the closure-helper pass.
const declarationBodyContainsHookCall = (symbol: SymbolDescriptor): boolean => {
  const componentFunction = isComponentDeclaration(symbol.declarationNode)
    ? symbol.declarationNode
    : symbol.initializer;
  if (!componentFunction) return false;
  let didFindHookCall = false;
  walkAst(componentFunction, (descendant) => {
    if (didFindHookCall) return false;
    if (!isNodeOfType(descendant, "CallExpression")) return;
    const calleeName = getCalleeName(descendant);
    if (calleeName && isReactHookName(calleeName)) {
      didFindHookCall = true;
      return false;
    }
  });
  return didFindHookCall;
};

// A React component receives a single props object; a PascalCase function
// declared with two or more parameters (`BoldedText(text, highlight)`) is a
// formatting helper that happens to return JSX, and calling it positionally
// is the only way to use it.
const declarationTakesMultiplePositionalArguments = (symbol: SymbolDescriptor): boolean => {
  const componentFunction = isComponentDeclaration(symbol.declarationNode)
    ? symbol.declarationNode
    : symbol.initializer;
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  return (componentFunction.params?.length ?? 0) >= 2;
};

// An `async function` component cannot own hooks, fiber state, or
// memoization — none of the harms this rule warns about apply — and
// calling it directly (`TokensAsync(props)`) is a deliberate RSC pattern
// (the returned promise renders like an element in a server tree).
const declarationIsAsyncFunction = (symbol: SymbolDescriptor): boolean => {
  const componentFunction = isComponentDeclaration(symbol.declarationNode)
    ? symbol.declarationNode
    : symbol.initializer;
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  return componentFunction.async === true;
};

// `React.useCallback(() => MenuIcon({ isChildrenVisible }), [deps])` builds
// an adapter component whose render IS the call — the produced elements get
// fibers normally when the adapter is rendered, so the call happens inside
// React, not outside it. Only the exact shape is exempt: the call feeds the
// returned expression of an arrow passed directly to useCallback, and the
// callee is hook-free (a hook-owning callee would splice its hooks into the
// adapter's hook order, which the rule must keep flagging).
const isReturnedFromUseCallbackAdapter = (callNode: EsTreeNode): boolean => {
  let current: EsTreeNode = callNode;
  let parent: EsTreeNode | null | undefined = callNode.parent;
  while (parent) {
    if (isNodeOfType(parent, "ArrowFunctionExpression")) {
      if (parent.body !== current) return false;
      const grandparent = parent.parent;
      return (
        isNodeOfType(grandparent, "CallExpression") &&
        getCalleeName(grandparent) === "useCallback" &&
        grandparent.arguments.some((argumentNode) => argumentNode === parent)
      );
    }
    if (
      !isNodeOfType(parent, "ConditionalExpression") &&
      !isNodeOfType(parent, "LogicalExpression")
    ) {
      return false;
    }
    current = parent;
    parent = parent.parent;
  }
  return false;
};

// A component is only flagged on strong, shadow-safe evidence: the called
// identifier resolves to a same-file component definition that returns JSX, OR
// to an imported binding that is also rendered as a JSX element in this file.
// PascalCase factories/built-ins (`Boolean(x)`, `MyEnum()`) resolve to a
// global or a non-component binding and are never flagged.
export const noCallComponentAsFunction = defineRule({
  id: "no-call-component-as-function",
  title: "Component called as a function",
  severity: "warn",
  // Test/story files routinely call hookless wrapper components as functions
  // and pass the result to `render(...)` — harmless there, and the dominant
  // real-world firing surface (verified via an OSS eval sweep). `test-noise`
  // skips those files so the rule only nags shipped code.
  tags: ["test-noise"],
  recommendation:
    "Render components as JSX (`<Component />`), never call them like functions (`Component(props)`). A direct call runs the component outside React and breaks hooks, state, and memoization.",
  create: (context: RuleContext) => {
    // Keyed by the BINDING IDENTIFIER node, not name: a rendered `<Item/>`
    // of one binding must not count as instantiation of a same-named
    // different binding (an inline render helper shadowing an import, or
    // two components in one file sharing a name). The binding node (not
    // the symbol id) is the key because scope analysis can register a
    // hoisted declaration under two symbol records sharing one binding.
    const renderedComponentBindings = new Set<EsTreeNode>();
    const candidateCalls: Array<{
      node: EsTreeNode;
      callee: EsTreeNode;
      name: string;
    }> = [];

    const recordRenderedComponent = (identifier: EsTreeNode): void => {
      const symbol = context.scopes.symbolFor(identifier);
      if (symbol) renderedComponentBindings.add(symbol.bindingIdentifier);
    };

    const visitors: RuleVisitors = {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && isUppercaseName(node.name.name)) {
          recordRenderedComponent(node.name as EsTreeNode);
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // `createElement(Name, …)` is a real instantiation, same as `<Name/>`.
        if (isCreateElementCall(node)) {
          const firstArgument = node.arguments[0];
          if (firstArgument && isNodeOfType(firstArgument, "Identifier")) {
            recordRenderedComponent(firstArgument);
          }
        }
        if (isNodeOfType(node.callee, "Identifier") && isUppercaseName(node.callee.name)) {
          candidateCalls.push({
            node,
            callee: node.callee,
            name: node.callee.name,
          });
        }
      },
      "Program:exit"() {
        for (const candidate of candidateCalls) {
          const symbol = context.scopes.symbolFor(candidate.callee);
          if (!symbol) continue;
          const isRendered = renderedComponentBindings.has(symbol.bindingIdentifier);
          const isLocalComponent =
            symbolIsLocalComponent(symbol, context) &&
            (isModuleScopeDeclaration(symbol.declarationNode) ||
              isRendered ||
              declarationBodyContainsHookCall(symbol));
          const isComponent = isLocalComponent || (symbol.kind === "import" && isRendered);
          if (!isComponent) continue;
          if (declarationTakesMultiplePositionalArguments(symbol)) continue;
          if (declarationIsAsyncFunction(symbol)) continue;
          if (
            !declarationBodyContainsHookCall(symbol) &&
            isReturnedFromUseCallbackAdapter(candidate.node)
          ) {
            continue;
          }
          context.report({
            node: candidate.node,
            message: message(candidate.name),
          });
        }
      },
    };
    return visitors;
  },
});
