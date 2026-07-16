import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);

const parameterIdentifier = (parameter: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  if (isNodeOfType(parameter, "Identifier")) return parameter;
  if (isNodeOfType(parameter, "AssignmentPattern") && isNodeOfType(parameter.left, "Identifier")) {
    return parameter.left;
  }
  return null;
};

const parameterTypeNode = (parameter: EsTreeNode): EsTreeNode | null => {
  const identifier = parameterIdentifier(parameter);
  if (!identifier) return null;
  const annotation = identifier.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return null;
  return (annotation.typeAnnotation as EsTreeNode | undefined) ?? null;
};

// TSParenthesizedType is absent from @typescript-eslint/types, so match by type string.
const unwrapParenthesizedType = (typeNode: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode = typeNode;
  while ((current as { type: string }).type === "TSParenthesizedType") {
    const inner = (current as { typeAnnotation?: EsTreeNode }).typeAnnotation;
    if (!inner) break;
    current = inner;
  }
  return current;
};

const functionTypeCanReturnCleanup = (typeNode: EsTreeNode): boolean => {
  if (!isNodeOfType(typeNode, "TSFunctionType")) return false;
  const returnAnnotation = typeNode.returnType;
  if (!returnAnnotation || !isNodeOfType(returnAnnotation, "TSTypeAnnotation")) return false;
  const returnType = returnAnnotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(returnType, "TSUnionType")) return false;
  return (returnType.types ?? []).some((member) =>
    isNodeOfType(unwrapParenthesizedType(member as EsTreeNode), "TSFunctionType"),
  );
};

const parameterIsEffectCallback = (parameter: EsTreeNode): boolean => {
  const typeNode = parameterTypeNode(parameter);
  if (!typeNode) return false;
  if (
    isNodeOfType(typeNode, "TSTypeReference") &&
    isNodeOfType(typeNode.typeName, "Identifier") &&
    typeNode.typeName.name === "EffectCallback"
  ) {
    return true;
  }
  return functionTypeCanReturnCleanup(typeNode);
};

const wrapperBindingIsTypedAsEffectHook = (hookFunction: EsTreeNode): boolean => {
  const declarator = hookFunction.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.id, "Identifier")) return false;
  const annotation = declarator.id.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return false;
  const query = annotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(query, "TSTypeQuery")) return false;
  return isNodeOfType(query.exprName, "Identifier") && EFFECT_HOOK_NAMES.has(query.exprName.name);
};

const forwardedEffectCallbackParameterName = (hookFunction: EsTreeNode): string | null => {
  if (!isFunctionLike(hookFunction)) return null;
  const params = hookFunction.params ?? [];
  if (wrapperBindingIsTypedAsEffectHook(hookFunction)) {
    const firstParam = params[0];
    return firstParam ? (parameterIdentifier(firstParam as EsTreeNode)?.name ?? null) : null;
  }
  for (const param of params) {
    if (parameterIsEffectCallback(param)) {
      return parameterIdentifier(param)?.name ?? null;
    }
  }
  return null;
};

const discardedForwardedCallInExpression = (
  expression: EsTreeNode,
  callbackName: string,
): EsTreeNode | null => {
  if (isNodeOfType(expression, "ChainExpression")) {
    return discardedForwardedCallInExpression(expression.expression, callbackName);
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      discardedForwardedCallInExpression(expression.left, callbackName) ??
      discardedForwardedCallInExpression(expression.right, callbackName)
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      discardedForwardedCallInExpression(expression.consequent, callbackName) ??
      discardedForwardedCallInExpression(expression.alternate, callbackName)
    );
  }
  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === callbackName
  ) {
    // `refCallback(null)` — a React 19 cleanup-style ref callback's detach
    // call returns nothing meaningful by contract; only the ATTACH call's
    // return carries the cleanup.
    const onlyArgument = expression.arguments?.length === 1 ? expression.arguments[0] : null;
    if (onlyArgument && isNodeOfType(onlyArgument, "Literal") && onlyArgument.value === null) {
      return null;
    }
    return expression;
  }
  return null;
};

// `for (const effect of queue) { effect(); }` rebinds the forwarded name —
// calls of the loop variable are a different binding.
const statementRebindsCallbackName = (statement: EsTreeNode, callbackName: string): boolean => {
  if (!isNodeOfType(statement, "ForOfStatement") && !isNodeOfType(statement, "ForInStatement")) {
    return false;
  }
  const left = statement.left;
  if (!isNodeOfType(left, "VariableDeclaration")) return false;
  return (left.declarations ?? []).some(
    (declarator) =>
      isNodeOfType(declarator.id, "Identifier") && declarator.id.name === callbackName,
  );
};

const findBareForwardedCall = (effectBody: EsTreeNode, callbackName: string): EsTreeNode | null => {
  let bareCall: EsTreeNode | null = null;
  walkAst(effectBody, (child) => {
    if (bareCall) return false;
    if (child !== effectBody && isFunctionLike(child)) return false;
    if (statementRebindsCallbackName(child, callbackName)) return false;
    if (!isNodeOfType(child, "ExpressionStatement")) return;
    const forwardedCall = discardedForwardedCallInExpression(child.expression, callbackName);
    if (forwardedCall) {
      bareCall = forwardedCall;
      return false;
    }
  });
  return bareCall;
};

export const noEffectWrapperDiscardsCallbackCleanupReturn = defineRule({
  id: "no-effect-wrapper-discards-callback-cleanup-return",
  title: "Effect wrapper discards forwarded cleanup return",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A custom effect wrapper must return its forwarded EffectCallback's result so React can run the cleanup. Calling it as a bare `fn()` instead of `return fn()` silently drops the cleanup, leaking every subscription/timer/listener it set up.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = getCalleeName(node);
      if (!calleeName || !EFFECT_HOOK_NAMES.has(calleeName)) return;

      const effectCallback = node.arguments?.[0];
      // `useEffect(effect, deps)` forwards the callback directly (React
      // wires its return) — only inline effect bodies can drop it.
      if (!effectCallback || !isFunctionLike(effectCallback)) return;
      const effectBody = effectCallback.body;
      if (!isNodeOfType(effectBody, "BlockStatement")) return;

      const hookFunction = findEnclosingFunction(node);
      if (!hookFunction) return;
      const hookName = componentOrHookDisplayNameForFunction(hookFunction);
      if (!hookName || !isReactHookName(hookName)) return;

      const callbackName = forwardedEffectCallbackParameterName(hookFunction);
      if (!callbackName) return;

      const bareCall = findBareForwardedCall(effectBody, callbackName);
      if (!bareCall) return;
      context.report({
        node: bareCall,
        message:
          "This forwards an EffectCallback but calls it as a bare statement, so the cleanup it returns is discarded and never runs (leaking its subscriptions/timers/listeners). Return it instead: `return " +
          callbackName +
          "();`.",
      });
    },
  }),
});
