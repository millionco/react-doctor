import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isComponentParameterSymbol } from "../../utils/is-component-parameter-symbol.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

// `({ renderItem }) => …` / `const { renderItem } = props` /
// `const renderItem = props.renderItem`: the callee resolves to a COMPONENT
// parameter or a name whose declaration roots in one (a render prop owned by
// the parent). Its identity is the parent's, so calling it inline remounts
// nothing — the same render-prop carve-out as the `props.renderX()` shape,
// for the destructured and plain-alias spellings. A locally-declared
// `renderRow` helper, or a parameter of an ordinary nested helper, still
// carries the smell and stays flagged.
const tracesToPropOrParameter = (
  symbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  if (!symbol || visitedSymbols.has(symbol)) return false;
  visitedSymbols.add(symbol);
  if (isComponentParameterSymbol(symbol)) return true;
  if (!isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  const source = symbol.initializer;
  if (!source) return false;
  return initializerRootsInProps(source, scopes, visitedSymbols);
};

// The initializer of a destructuring (`const { renderItem } = props.slots`)
// or plain alias (`const renderItem = props.renderItem`) is parent-owned
// when it roots in `props` / `this.props`, including the defaulted spellings
// `props.renderItem ?? defaultRender` and
// `cond ? props.renderItem : renderFallback` where an operand roots there.
const initializerRootsInProps = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  if (isNodeOfType(node, "LogicalExpression")) {
    return (
      initializerRootsInProps(node.left, scopes, visitedSymbols) ||
      initializerRootsInProps(node.right, scopes, visitedSymbols)
    );
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      initializerRootsInProps(node.consequent, scopes, visitedSymbols) ||
      initializerRootsInProps(node.alternate, scopes, visitedSymbols)
    );
  }
  return rootsInProps(node, scopes, visitedSymbols);
};

// True when a member-expression chain bottoms out in a COMPONENT parameter
// (`props.slots.header`, or `slots.header` where `slots` is a component
// parameter), a `this.props` access (`this.props.slots`), or a local alias
// whose declaration roots in one (`const slots = props.slots` then
// `slots.renderItem()`). The root is resolved through scope, so a local
// variable named `props` is NOT treated as the component's props bag. Also
// gates the inline member-call receiver, so `props.slots.renderItem()` is
// exempt for the same reason its destructured form
// (`const { renderItem } = props.slots`) already is.
const rootsInProps = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  let current: EsTreeNode = node;
  while (isNodeOfType(current, "MemberExpression")) {
    if (
      isNodeOfType(current.object, "ThisExpression") &&
      isNodeOfType(current.property, "Identifier") &&
      current.property.name === "props"
    ) {
      return true;
    }
    current = current.object;
  }
  if (isNodeOfType(current, "Identifier")) {
    return tracesToPropOrParameter(scopes.symbolFor(current), scopes, visitedSymbols);
  }
  return false;
};

// A render* call in a module of render HELPERS (`renderItems.tsx` composing
// `renderIcon(Check)` inside `renderDropdownMenuItems`) happens outside any
// component render: there is no component identity, state, or memoization to
// lose, and extracting a component would change nothing observable. Class
// bodies count as component context so `this.renderX()` class-field helpers
// keep firing.
const isInsideComponentContext = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "ClassDeclaration") || isNodeOfType(cursor, "ClassExpression")) {
      return true;
    }
    if (isFunctionLike(cursor) && isComponentFunction(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const functionBodyOf = (node: EsTreeNode): EsTreeNode | null => {
  if (isFunctionLike(node)) return node.body ?? null;
  if (isNodeOfType(node, "VariableDeclarator") && node.init && isFunctionLike(node.init)) {
    return node.init.body ?? null;
  }
  return null;
};

const containsHookCall = (body: EsTreeNode): boolean => {
  let found = false;
  walkAst(body, (child: EsTreeNode) => {
    if (found) return;
    if (!isNodeOfType(child, "CallExpression")) return;
    const name = getCalleeName(child);
    if (name && isReactHookName(name)) found = true;
  });
  return found;
};

// `renderMessage` declared at MODULE scope with no hook calls is a pure
// formatter: it cannot close over component state, so calling it inline is
// byte-for-byte equivalent to writing its JSX in place — nothing for an
// extracted component to preserve.
const isModuleScopeHookFreeHelper = (symbol: SymbolDescriptor | null): boolean => {
  if (!symbol) return false;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "FunctionDeclaration") &&
    !isNodeOfType(declaration, "VariableDeclarator")
  ) {
    return false;
  }
  const body = functionBodyOf(declaration);
  if (!body) return false;
  if (findEnclosingFunction(declaration) !== null) return false;
  return !containsHookCall(body);
};

export const noRenderInRender = defineRule({
  id: "no-render-in-render",
  title: "Component rendered by inline function call",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Make it a named component rendered as JSX so React can track it and preserve its state.",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      const expression = node.expression;
      if (!isNodeOfType(expression, "CallExpression")) return;

      let calleeName: string | null = null;
      if (isNodeOfType(expression.callee, "Identifier")) {
        calleeName = expression.callee.name;
      } else if (
        isNodeOfType(expression.callee, "MemberExpression") &&
        isNodeOfType(expression.callee.property, "Identifier")
      ) {
        calleeName = expression.callee.property.name;
      }

      if (!calleeName || !RENDER_FUNCTION_PATTERN.test(calleeName)) return;

      if (!isInsideComponentContext(node)) return;

      if (isNodeOfType(expression.callee, "Identifier")) {
        const calleeSymbol = context.scopes.symbolFor(expression.callee);
        if (tracesToPropOrParameter(calleeSymbol, context.scopes)) return;
        if (isModuleScopeHookFreeHelper(calleeSymbol)) return;
      } else if (isNodeOfType(expression.callee, "MemberExpression")) {
        if (rootsInProps(expression.callee.object, context.scopes)) return;
      }

      context.report({
        node: expression,
        message: `"${calleeName}()" hides a component behind an inline call, so pull it into its own component and render it as JSX so React can track it.`,
      });
    },
  }),
});
