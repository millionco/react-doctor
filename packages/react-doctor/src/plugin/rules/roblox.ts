import {
  EFFECT_HOOK_NAMES,
  ROBLOX_CONNECTION_METHODS,
  ROBLOX_PRINT_FUNCTIONS,
} from "../constants.js";
import {
  getCallbackStatements,
  getEffectCallback,
  isHookCall,
  isMemberProperty,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const hasDisconnectInCleanup = (effectCallback: EsTreeNode): boolean => {
  const statements = getCallbackStatements(effectCallback);
  if (statements.length === 0) return false;

  const lastStatement = statements[statements.length - 1];
  if (lastStatement.type !== "ReturnStatement" || !lastStatement.argument) return false;

  const cleanupFunction = lastStatement.argument;
  if (
    cleanupFunction.type !== "ArrowFunctionExpression" &&
    cleanupFunction.type !== "FunctionExpression"
  ) {
    return false;
  }

  let hasCleanup = false;
  walkAst(cleanupFunction, (node) => {
    if (node.type === "CallExpression") {
      if (isMemberProperty(node.callee, "Disconnect") || isMemberProperty(node.callee, "Destroy")) {
        hasCleanup = true;
      }
    }
  });

  return hasCleanup;
};

export const rbxNoUncleanedConnection: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const effectCallback = getEffectCallback(node);
      if (!effectCallback) return;

      let hasConnectionCall = false;
      walkAst(effectCallback, (child) => {
        if (child.type === "CallExpression" && child.callee?.type === "MemberExpression") {
          const methodName =
            child.callee.property?.type === "Identifier" ? child.callee.property.name : null;
          if (methodName && ROBLOX_CONNECTION_METHODS.has(methodName)) {
            hasConnectionCall = true;
          }
        }
      });

      if (hasConnectionCall && !hasDisconnectInCleanup(effectCallback)) {
        context.report({
          node,
          message:
            ".Connect() inside useEffect without cleanup — call connection.Disconnect() or instance.Destroy() in the cleanup function",
        });
      }
    },
  }),
};

export const rbxNoPrint: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier") return;
      const functionName = node.callee.name;
      if (!ROBLOX_PRINT_FUNCTIONS.has(functionName)) return;

      context.report({
        node,
        message: `${functionName}() left in code — remove or replace with a logging utility for production`,
      });
    },
  }),
};

export const rbxNoDirectInstanceMutation: Rule = {
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNode) {
      if (node.left?.type !== "MemberExpression") return;

      let hasRefCurrent = false;
      let currentNode = node.left.object;

      while (currentNode && currentNode.type === "MemberExpression") {
        if (isMemberProperty(currentNode, "current")) {
          hasRefCurrent = true;
          break;
        }
        currentNode = currentNode.object;
      }

      if (hasRefCurrent) {
        const propertyName =
          node.left.property?.type === "Identifier" ? node.left.property.name : "property";
        context.report({
          node,
          message: `Direct mutation of ref.current.${propertyName} bypasses React — pass as a prop instead`,
        });
      }
    },
  }),
};

const isInsideEffectHook = (node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current) {
    if (
      current.type === "CallExpression" &&
      current.callee?.type === "Identifier" &&
      EFFECT_HOOK_NAMES.has(current.callee.name)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

export const rbxNoUnstoredConnection: Rule = {
  create: (context: RuleContext) => ({
    ExpressionStatement(node: EsTreeNode) {
      if (node.expression?.type !== "CallExpression") return;
      const callExpression = node.expression;

      if (callExpression.callee?.type !== "MemberExpression") return;
      const methodName =
        callExpression.callee.property?.type === "Identifier"
          ? callExpression.callee.property.name
          : null;
      if (!methodName || !ROBLOX_CONNECTION_METHODS.has(methodName)) return;

      if (isInsideEffectHook(node)) return;

      context.report({
        node: callExpression,
        message:
          "Connection from .Connect() is not stored — assign to a variable so it can be disconnected later",
      });
    },
  }),
};
