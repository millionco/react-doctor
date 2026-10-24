import { isUndefined } from "./is-undefined.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";

interface EventHandlerInvocationProof {
  readonly component: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly context: RuleContext;
  readonly isReadonlyBinding: (symbol: SymbolDescriptor) => boolean;
  readonly isEventOwner?: (owner: EsTreeNode | null, reference: EsTreeNode) => boolean;
}

export const hasOnlyEventHandlerInvocations = (
  functionNode: EsTreeNode | null,
  proof: EventHandlerInvocationProof,
  visited: ReadonlySet<EsTreeNode> = new Set(),
  proven: Set<EsTreeNode> = new Set(),
): boolean => {
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") ||
    functionNode === proof.component ||
    visited.has(functionNode)
  )
    return false;
  if (proven.has(functionNode)) return true;
  const identifier = getFunctionBindingIdentifier(functionNode);
  const symbol = identifier && proof.scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  if (
    symbol?.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !declaration.init ||
    !proof.isReadonlyBinding(symbol)
  )
    return false;
  const initializer = stripParenExpression(declaration.init);
  if (initializer !== functionNode) {
    const [callback] = isNodeOfType(initializer, "CallExpression") ? initializer.arguments : [];
    if (
      !isNodeOfType(initializer, "CallExpression") ||
      callback !== functionNode ||
      !hasRefNotificationReactCall(initializer, "useCallback", proof.context)
    )
      return false;
  }
  const nextVisited = new Set([...visited, functionNode]);
  let uses = 0;
  for (const reference of symbol.references) {
    if (isNonReferenceIdentifier(reference.identifier)) continue;
    uses += 1;
    let root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    const dependencyCall = isNodeOfType(call, "ArrayExpression") ? call.parent : null;
    const [, dependencies] = isNodeOfType(dependencyCall, "CallExpression")
      ? dependencyCall.arguments
      : [];
    if (
      isNodeOfType(call, "ArrayExpression") &&
      isNodeOfType(dependencyCall, "CallExpression") &&
      dependencies === call &&
      ["useCallback", "useEffect", "useMemo"].some((apiName) =>
        hasRefNotificationReactCall(dependencyCall, apiName, proof.context),
      )
    )
      continue;
    if (isNodeOfType(call, "CallExpression") && call.callee === root) {
      if (
        call.optional ||
        !hasOnlyEventHandlerInvocations(findEnclosingFunction(call), proof, nextVisited, proven)
      )
        return false;
      continue;
    }
    while (root.parent) {
      const parent = root.parent;
      if (
        isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === root || parent.alternate === root) &&
        isUndefined(parent.consequent === root ? parent.alternate : parent.consequent, proof.scopes)
      ) {
        root = findTransparentExpressionRoot(parent);
        continue;
      }
      if (
        isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.right === root
      ) {
        root = findTransparentExpressionRoot(parent);
        continue;
      }
      break;
    }
    const container = root.parent;
    if (
      !isNodeOfType(container, "JSXExpressionContainer") ||
      container.expression !== root ||
      !isEventHandlerAttribute(container.parent) ||
      !(proof.isEventOwner
        ? proof.isEventOwner(findEnclosingFunction(reference.identifier), reference.identifier)
        : findEnclosingFunction(reference.identifier) === proof.component)
    )
      return false;
  }
  if (uses === 0) return false;
  proven.add(functionNode);
  return true;
};
