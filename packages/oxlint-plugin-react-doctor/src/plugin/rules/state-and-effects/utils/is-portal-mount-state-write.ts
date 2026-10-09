import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../../utils/is-proven-browser-api-receiver.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveReactRefCurrentOriginSymbol } from "../../../utils/react-ref-origin.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const requiresMountedState = (
  expression: EsTreeNode,
  state: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const test = stripParenExpression(expression);
  if (isNodeOfType(test, "Identifier")) return context.scopes.symbolFor(test) === state;
  return (
    isNodeOfType(test, "LogicalExpression") &&
    test.operator === "&&" &&
    (requiresMountedState(test.left, state, context) ||
      requiresMountedState(test.right, state, context))
  );
};

export const isPortalMountStateWrite = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression") || readStaticBoolean(write.arguments[0]) !== true)
    return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  if (
    !pair?.stateSymbol ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    readStaticBoolean(pair.declarator.init.arguments[0]) !== false
  )
    return false;
  const state = pair.stateSymbol;
  const callback = findEnclosingFunction(write);
  const component = findEnclosingFunction(pair.declarator);
  if (!callback || !component) return false;
  const discoveredRefs = new Set<SymbolDescriptor>();
  walkAst(callback, (node) => {
    if (node !== callback && isFunctionLike(node)) return false;
    if (
      !isNodeOfType(node, "AssignmentExpression") ||
      node.operator !== "=" ||
      !isNodeOfType(node.right, "CallExpression") ||
      !isNodeOfType(node.right.callee, "MemberExpression")
    )
      return;
    const callee = node.right.callee;
    if (
      getStaticPropertyName(callee) !== "querySelector" ||
      !isNodeOfType(callee.object, "Identifier") ||
      callee.object.name !== "document" ||
      !isProvenBrowserApiReceiver(callee.object, "dom-event-target", context.scopes) ||
      !nodeDominatesNode(node, write, context)
    )
      return;
    const ref = resolveReactRefCurrentOriginSymbol(node.left, context.scopes);
    if (ref) discoveredRefs.add(ref);
  });
  if (discoveredRefs.size === 0) return false;
  let hasGuardedPortal = false;
  walkAst(component, (node) => {
    if (hasGuardedPortal || (node !== component && isFunctionLike(node))) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const api = resolveImportedApiReference(node.callee, context.scopes);
    if (api?.source !== "react-dom" || api.importedName !== "createPortal") return;
    const container = node.arguments[1];
    const ref = container ? resolveReactRefCurrentOriginSymbol(container, context.scopes) : null;
    if (!ref || !discoveredRefs.has(ref)) return;
    let ancestor = node.parent;
    while (ancestor && ancestor !== component) {
      let guard: EsTreeNode | null = null;
      if (
        isNodeOfType(ancestor, "ConditionalExpression") &&
        isAstDescendant(node, ancestor.consequent)
      )
        guard = ancestor.test;
      else if (
        isNodeOfType(ancestor, "LogicalExpression") &&
        ancestor.operator === "&&" &&
        isAstDescendant(node, ancestor.right)
      )
        guard = ancestor.left;
      if (guard && requiresMountedState(guard, state, context)) {
        hasGuardedPortal = true;
        return false;
      }
      ancestor = ancestor.parent;
    }
  });
  return hasGuardedPortal;
};
