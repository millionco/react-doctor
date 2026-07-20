import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import { isGlobalAnimationFrameCallee } from "../../utils/is-global-animation-frame-callee.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const STOP_GATE_NODE_TYPES: ReadonlySet<string> = new Set([
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "SwitchStatement",
  "TryStatement",
]);

const isRequestIdRetained = (callExpression: EsTreeNode): boolean => {
  const parent = callExpression.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === callExpression) return true;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.right === callExpression) return true;
  return isNodeOfType(parent, "ReturnStatement") && parent.argument === callExpression;
};

const findUnboundedRecursiveRequest = (
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  const functionName = getFunctionBindingName(functionNode);
  if (!functionName) return null;
  let hasStopGate = false;
  let recursiveRequest: EsTreeNode | null = null;

  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (STOP_GATE_NODE_TYPES.has(child.type)) hasStopGate = true;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isGlobalAnimationFrameCallee(child.callee, context.scopes)) return;
    const callback = child.arguments?.[0];
    if (!isNodeOfType(callback, "Identifier") || callback.name !== functionName) return;
    if (isRequestIdRetained(child)) return;
    recursiveRequest = child;
  });

  return hasStopGate ? null : recursiveRequest;
};

export const noUnboundedAnimationFrameLoop = defineRule({
  id: "no-unbounded-animation-frame-loop",
  title: "Animation frame loop has no stop path",
  severity: "warn",
  defaultEnabled: false,
  recommendation:
    "Add an explicit stop condition and retain each request ID so the active frame can be cancelled when the animation or component stops.",
  create: (context) => {
    const shouldIgnoreFile = isTestlikeFilename(context.filename);
    const inspectFunction = (node: EsTreeNode): void => {
      if (shouldIgnoreFile) return;
      const recursiveRequest = findUnboundedRecursiveRequest(node, context);
      if (!recursiveRequest) return;
      context.report({
        node: recursiveRequest,
        message:
          "This callback schedules itself forever with no stop path and discards the active request ID. Add a stop condition and retain the ID for cancelAnimationFrame().",
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        inspectFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        inspectFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        inspectFunction(node);
      },
    };
  },
});
