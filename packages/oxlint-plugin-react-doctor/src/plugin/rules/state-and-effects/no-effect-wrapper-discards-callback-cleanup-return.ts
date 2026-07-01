import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
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

// The actual type node behind a parameter's `: T` annotation, or null.
const parameterTypeNode = (parameter: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(parameter, "Identifier")) return null;
  const annotation = parameter.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return null;
  return (annotation.typeAnnotation as EsTreeNode | undefined) ?? null;
};

// Unwraps `(T)` parenthesized type wrappers so union members compare
// against the semantic type. `TSParenthesizedType` is emitted by
// oxc-parser but absent from `@typescript-eslint/types`, so it is
// matched by its `.type` string rather than through `isNodeOfType`.
const unwrapParenthesizedType = (typeNode: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode = typeNode;
  while ((current as { type: string }).type === "TSParenthesizedType") {
    const inner = (current as { typeAnnotation?: EsTreeNode }).typeAnnotation;
    if (!inner) break;
    current = inner;
  }
  return current;
};

// True for a function type whose return can be a cleanup function, i.e.
// `() => void | (() => void)`: the return type is a union that includes
// a function type. A plain `() => void` returns false (cannot).
const functionTypeCanReturnCleanup = (typeNode: EsTreeNode): boolean => {
  if (!isNodeOfType(typeNode, "TSFunctionType")) return false;
  const returnAnnotation = typeNode.returnType;
  if (!returnAnnotation || !isNodeOfType(returnAnnotation, "TSTypeAnnotation"))
    return false;
  const returnType = returnAnnotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(returnType, "TSUnionType")) return false;
  return (returnType.types ?? []).some((member) =>
    isNodeOfType(
      unwrapParenthesizedType(member as EsTreeNode),
      "TSFunctionType"
    )
  );
};

// A parameter typed `EffectCallback` or `() => (void | (() => void))`.
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

// True when the wrapper binding is annotated `typeof useEffect` /
// `typeof useLayoutEffect`, so its first parameter is the EffectCallback.
const wrapperBindingIsTypedAsEffectHook = (
  hookFunction: EsTreeNode
): boolean => {
  const declarator = hookFunction.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator"))
    return false;
  if (!isNodeOfType(declarator.id, "Identifier")) return false;
  const annotation = declarator.id.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation"))
    return false;
  const query = annotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(query, "TSTypeQuery")) return false;
  return (
    isNodeOfType(query.exprName, "Identifier") &&
    EFFECT_HOOK_NAMES.has(query.exprName.name)
  );
};

// The name of the forwarded EffectCallback parameter of a custom hook,
// or null when no parameter is a resolvable EffectCallback.
const forwardedEffectCallbackParameterName = (
  hookFunction: EsTreeNode
): string | null => {
  if (!isFunctionLike(hookFunction)) return null;
  const params = hookFunction.params ?? [];
  if (wrapperBindingIsTypedAsEffectHook(hookFunction)) {
    const firstParam = params[0];
    return firstParam && isNodeOfType(firstParam as EsTreeNode, "Identifier")
      ? (firstParam as EsTreeNodeOfType<"Identifier">).name
      : null;
  }
  for (const param of params) {
    if (parameterIsEffectCallback(param as EsTreeNode)) {
      return (param as EsTreeNodeOfType<"Identifier">).name;
    }
  }
  return null;
};

// The bare `fn()` expression statement inside `effectBody` that invokes
// `callbackName` without returning it, or null. Nested functions are
// pruned; `return fn()` is a ReturnStatement and never matches.
const findBareForwardedCall = (
  effectBody: EsTreeNode,
  callbackName: string
): EsTreeNode | null => {
  let bareCall: EsTreeNode | null = null;
  walkAst(effectBody, (child) => {
    if (bareCall) return false;
    if (child !== effectBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ExpressionStatement")) return;
    const expression = child.expression;
    if (
      isNodeOfType(expression, "CallExpression") &&
      isNodeOfType(expression.callee, "Identifier") &&
      expression.callee.name === callbackName
    ) {
      bareCall = expression as EsTreeNode;
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
      const effectBody = effectCallback.body as EsTreeNode;
      if (!isNodeOfType(effectBody, "BlockStatement")) return;

      const hookFunction = nearestEnclosingFunction(node);
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
