import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import {
  getImportedNameFromModule,
  getImportSourceForName,
} from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenEffectHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

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
  if (isNodeOfType(unwrapParenthesizedType(returnType), "TSFunctionType")) return true;
  if (!isNodeOfType(returnType, "TSUnionType")) return false;
  return (returnType.types ?? []).some((member) =>
    isNodeOfType(unwrapParenthesizedType(member as EsTreeNode), "TSFunctionType"),
  );
};

const symbolForTypeIdentifier = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const directSymbol = scopes.symbolFor(identifier);
  if (directSymbol) return directSymbol;
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(identifier);
  while (scope) {
    const symbol = scope.symbolsByName.get(identifier.name);
    if (symbol) return symbol;
    scope = scope.parent;
  }
  return null;
};

const isImportedOrGlobalReactIdentifier = (
  identifier: EsTreeNode,
  exportedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = symbolForTypeIdentifier(identifier, scopes);
  if (!symbol) return identifier.name === exportedName;
  return (
    symbol.kind === "import" &&
    getImportedNameFromModule(identifier, identifier.name, "react") === exportedName
  );
};

const isReactNamespaceOrGlobalIdentifier = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier") || identifier.name !== "React") return false;
  const symbol = symbolForTypeIdentifier(identifier, scopes);
  return (
    !symbol || (symbol.kind === "import" && getImportSourceForName(identifier, "React") === "react")
  );
};

const parameterIsEffectCallback = (parameter: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const typeNode = parameterTypeNode(parameter);
  if (!typeNode) return false;
  if (
    isNodeOfType(typeNode, "TSTypeReference") &&
    (isImportedOrGlobalReactIdentifier(typeNode.typeName as EsTreeNode, "EffectCallback", scopes) ||
      (isNodeOfType(typeNode.typeName, "TSQualifiedName") &&
        isReactNamespaceOrGlobalIdentifier(typeNode.typeName.left as EsTreeNode, scopes) &&
        isNodeOfType(typeNode.typeName.right, "Identifier") &&
        typeNode.typeName.right.name === "EffectCallback"))
  ) {
    return true;
  }
  return functionTypeCanReturnCleanup(typeNode);
};

const wrapperBindingIsTypedAsEffectHook = (
  hookFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declarator = hookFunction.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.id, "Identifier")) return false;
  const annotation = declarator.id.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return false;
  const query = annotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(query, "TSTypeQuery")) return false;
  if (isNodeOfType(query.exprName, "Identifier")) {
    return (
      EFFECT_HOOK_NAMES.has(query.exprName.name) &&
      isImportedOrGlobalReactIdentifier(query.exprName, query.exprName.name, scopes)
    );
  }
  return (
    isNodeOfType(query.exprName, "TSQualifiedName") &&
    isReactNamespaceOrGlobalIdentifier(query.exprName.left as EsTreeNode, scopes) &&
    isNodeOfType(query.exprName.right, "Identifier") &&
    EFFECT_HOOK_NAMES.has(query.exprName.right.name)
  );
};

const forwardedEffectCallbackParameterName = (
  hookFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isFunctionLike(hookFunction)) return null;
  const params = hookFunction.params ?? [];
  if (wrapperBindingIsTypedAsEffectHook(hookFunction, scopes)) {
    const firstParam = params[0];
    return firstParam ? (parameterIdentifier(firstParam as EsTreeNode)?.name ?? null) : null;
  }
  for (const param of params) {
    if (parameterIsEffectCallback(param, scopes)) {
      return parameterIdentifier(param)?.name ?? null;
    }
  }
  return null;
};

const discardedForwardedCallInExpression = (
  expression: EsTreeNode,
  callbackName: string,
  callbackBinding: EsTreeNode,
): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (unwrappedExpression !== expression) {
    return discardedForwardedCallInExpression(unwrappedExpression, callbackName, callbackBinding);
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      discardedForwardedCallInExpression(expression.left, callbackName, callbackBinding) ??
      discardedForwardedCallInExpression(expression.right, callbackName, callbackBinding)
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      discardedForwardedCallInExpression(expression.consequent, callbackName, callbackBinding) ??
      discardedForwardedCallInExpression(expression.alternate, callbackName, callbackBinding)
    );
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    return discardedForwardedCallInExpression(expression.argument, callbackName, callbackBinding);
  }
  if (isNodeOfType(expression, "SequenceExpression")) {
    for (const sequenceExpression of expression.expressions) {
      const discardedCall = discardedForwardedCallInExpression(
        sequenceExpression,
        callbackName,
        callbackBinding,
      );
      if (discardedCall) return discardedCall;
    }
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    if (
      !isNodeOfType(callee, "Identifier") ||
      callee.name !== callbackName ||
      findVariableInitializer(callee, callbackName)?.bindingIdentifier !== callbackBinding
    ) {
      return null;
    }
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

const discardedForwardedCallInReturnExpression = (
  returnArgument: EsTreeNode,
  callbackName: string,
  callbackBinding: EsTreeNode,
): EsTreeNode | null => {
  const expression = stripParenExpression(returnArgument);
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    return discardedForwardedCallInExpression(expression.argument, callbackName, callbackBinding);
  }
  if (!isNodeOfType(expression, "SequenceExpression")) return null;
  for (const sequenceExpression of expression.expressions.slice(0, -1)) {
    const discardedCall = discardedForwardedCallInExpression(
      sequenceExpression,
      callbackName,
      callbackBinding,
    );
    if (discardedCall) return discardedCall;
  }
  const returnedExpression = expression.expressions.at(-1);
  return returnedExpression
    ? discardedForwardedCallInReturnExpression(returnedExpression, callbackName, callbackBinding)
    : null;
};

const findBareForwardedCall = (
  effectBody: EsTreeNode,
  callbackName: string,
  callbackBinding: EsTreeNode,
): EsTreeNode | null => {
  let bareCall: EsTreeNode | null = null;
  walkAst(effectBody, (child) => {
    if (bareCall) return false;
    if (child !== effectBody && isFunctionLike(child)) return false;
    if (statementRebindsCallbackName(child, callbackName)) return false;
    const forwardedCall = isNodeOfType(child, "ExpressionStatement")
      ? discardedForwardedCallInExpression(child.expression, callbackName, callbackBinding)
      : isNodeOfType(child, "ReturnStatement") && child.argument
        ? discardedForwardedCallInReturnExpression(child.argument, callbackName, callbackBinding)
        : null;
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
      if (
        !calleeName ||
        !EFFECT_HOOK_NAMES.has(calleeName) ||
        !isProvenEffectHookCall(node, context.scopes)
      )
        return;

      const effectCallback = node.arguments?.[0];
      // `useEffect(effect, deps)` forwards the callback directly (React
      // wires its return) — only inline effect bodies can drop it.
      if (!effectCallback || !isFunctionLike(effectCallback)) return;
      const effectBody = effectCallback.body;
      if (!isNodeOfType(effectBody, "BlockStatement")) return;

      const hookFunction = findEnclosingFunction(node);
      if (!hookFunction || !isFunctionLike(hookFunction)) return;
      const hookName = componentOrHookDisplayNameForFunction(hookFunction);
      if (!hookName || !isReactHookName(hookName)) return;

      const callbackName = forwardedEffectCallbackParameterName(hookFunction, context.scopes);
      if (!callbackName) return;
      const callbackBinding = (hookFunction.params ?? [])
        .map((parameter) => parameterIdentifier(parameter as EsTreeNode))
        .find((parameter) => parameter?.name === callbackName);
      if (!callbackBinding) return;

      const bareCall = findBareForwardedCall(effectBody, callbackName, callbackBinding);
      if (!bareCall) return;
      const callbackSymbol = context.scopes.symbolFor(callbackBinding);
      if (
        callbackSymbol &&
        (hasSymbolWriteBefore(callbackSymbol, bareCall, context.scopes) ||
          callbackSymbol.references.some(
            (reference) =>
              reference.flag !== "read" && reference.identifier.range[0] < bareCall.range[0],
          ))
      )
        return;
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
