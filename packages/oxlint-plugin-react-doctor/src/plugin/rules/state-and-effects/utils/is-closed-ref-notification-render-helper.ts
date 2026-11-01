import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { REF_NOTIFICATION_UNSUPPORTED_RENDER_CONTROL_TYPES } from "./constants.js";

interface ClosedRefNotificationRenderHelperOptions {
  readonly helper: EsTreeNode | null;
  readonly component: EsTreeNode;
  readonly program: EsTreeNode;
  readonly context: RuleContext;
  readonly isRenderedCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean;
}

export const isClosedRefNotificationRenderHelper = ({
  helper,
  component,
  program,
  context,
  isRenderedCall,
}: ClosedRefNotificationRenderHelperOptions): boolean => {
  if (
    (!isNodeOfType(helper, "ArrowFunctionExpression") &&
      !isNodeOfType(helper, "FunctionExpression")) ||
    helper.async ||
    helper.generator ||
    (isNodeOfType(helper, "FunctionExpression") && helper.id !== null) ||
    helper.params.length ||
    findEnclosingFunction(helper) !== component
  )
    return false;
  let hasUnsupportedControlFlow = false;
  walkAst(helper.body, (node) => {
    if (
      isFunctionLike(node) ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression")
    )
      return false;
    if (REF_NOTIFICATION_UNSUPPORTED_RENDER_CONTROL_TYPES.has(node.type)) {
      hasUnsupportedControlFlow = true;
      return false;
    }
  });
  if (hasUnsupportedControlFlow) return false;
  const identifier = getFunctionBindingIdentifier(helper);
  const symbol = identifier && context.scopes.symbolFor(identifier);
  if (
    !symbol ||
    getDirectConstInitializer(symbol) !== helper ||
    symbol.references.length === 0 ||
    !hasCompleteSymbolReferences(symbol, program, context.scopes)
  )
    return false;
  return symbol.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    return (
      reference.flag === "read" &&
      !isWithinAssignmentTarget(reference.identifier) &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === root &&
      !call.optional &&
      call.arguments.length === 0 &&
      findEnclosingFunction(call) === component &&
      isNodeReachableWithinFunction(call, context) &&
      isRenderedCall(call)
    );
  });
};
