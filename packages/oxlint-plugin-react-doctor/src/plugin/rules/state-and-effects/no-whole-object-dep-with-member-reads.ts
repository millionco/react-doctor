import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const IDENTITY_SENSITIVE_HOOKS_WITH_DEPS = new Set([
  "useMemo",
  "useCallback",
  "useImperativeHandle",
]);
const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
  "toSorted",
]);
const CALLBACK_CONSUMER_NAMES = new Set([
  ...SYNCHRONOUS_CALLBACK_METHOD_NAMES,
  "addEventListener",
  "addListener",
  "catch",
  "finally",
  "once",
  "queueMicrotask",
  "register",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "subscribe",
  "then",
]);

interface DependencyUsage {
  hasBareUse: boolean;
  hasMemberRead: boolean;
}

const callConsumesOrEscapesCallback = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isFunctionLike(callee)) return true;
  if (isNodeOfType(callee, "Identifier")) return CALLBACK_CONSUMER_NAMES.has(callee.name);
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    CALLBACK_CONSUMER_NAMES.has(getStaticPropertyName(callee) ?? ""),
  );
};

const getPropsObjectSymbol = (
  componentFunction: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isFunctionLike(componentFunction)) return null;
  const firstParameter = componentFunction.params?.[0];
  const propsIdentifier = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  if (!isNodeOfType(propsIdentifier, "Identifier")) return null;
  return context.scopes.symbolFor(propsIdentifier);
};

const isConstAliasInitializer = (
  identifier: EsTreeNodeOfType<"Identifier">,
  propsSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const declarator = identifier.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== identifier ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return false;
  }
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return false;
  if (declaration.kind !== "const") return false;
  return resolveConstIdentifierAlias(declarator.id, context.scopes)?.id === propsSymbol.id;
};

const isMemberMutation = (memberExpression: EsTreeNode): boolean => {
  let expressionRoot = findTransparentExpressionRoot(memberExpression);
  while (
    expressionRoot.parent &&
    isNodeOfType(expressionRoot.parent, "MemberExpression") &&
    expressionRoot.parent.object === expressionRoot
  ) {
    expressionRoot = findTransparentExpressionRoot(expressionRoot.parent);
  }
  const parent = expressionRoot.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === expressionRoot) return true;
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === expressionRoot) return true;
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "delete" &&
    parent.argument === expressionRoot
  ) {
    return true;
  }
  if (
    (isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) &&
    parent.left === expressionRoot
  ) {
    return true;
  }
  return false;
};

const collectPropsMemberBindingSymbolIds = (
  propsSymbol: SymbolDescriptor,
  context: RuleContext,
): ReadonlySet<number> => {
  const symbolIds = new Set<number>();
  const collectPatternBindings = (pattern: EsTreeNode): void => {
    if (isNodeOfType(pattern, "Identifier")) {
      const bindingSymbol = context.scopes.symbolFor(pattern);
      if (bindingSymbol) symbolIds.add(bindingSymbol.id);
      return;
    }
    if (isNodeOfType(pattern, "AssignmentPattern")) {
      collectPatternBindings(pattern.left);
      return;
    }
    if (isNodeOfType(pattern, "RestElement")) {
      return;
    }
    if (isNodeOfType(pattern, "ObjectPattern")) {
      for (const property of pattern.properties) {
        if (isNodeOfType(property, "Property") && !property.computed) {
          collectPatternBindings(property.value);
        }
      }
      return;
    }
    if (isNodeOfType(pattern, "ArrayPattern")) {
      for (const element of pattern.elements) {
        if (element) collectPatternBindings(element);
      }
    }
  };
  const pendingSymbols = [propsSymbol];
  const visitedSymbolIds = new Set<number>();
  while (pendingSymbols.length > 0) {
    const sourceSymbol = pendingSymbols.pop();
    if (!sourceSymbol || visitedSymbolIds.has(sourceSymbol.id)) continue;
    visitedSymbolIds.add(sourceSymbol.id);
    for (const reference of sourceSymbol.references) {
      const identifier = reference.identifier;
      const parent = identifier.parent;
      if (parent && isNodeOfType(parent, "MemberExpression") && parent.object === identifier) {
        if (getStaticPropertyName(parent) === null || isMemberMutation(parent)) continue;
        const expressionRoot = findTransparentExpressionRoot(parent);
        const declarator = expressionRoot.parent;
        if (isNodeOfType(declarator, "VariableDeclarator") && declarator.init === expressionRoot) {
          collectPatternBindings(declarator.id);
        }
        continue;
      }
      if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== identifier) continue;
      if (isNodeOfType(parent.id, "Identifier")) {
        const aliasSymbol = context.scopes.symbolFor(parent.id);
        if (
          aliasSymbol &&
          resolveConstIdentifierAlias(parent.id, context.scopes)?.id === propsSymbol.id
        ) {
          pendingSymbols.push(aliasSymbol);
        }
        continue;
      }
      collectPatternBindings(parent.id);
    }
  }
  return symbolIds;
};

const countStaticDestructureReads = (pattern: EsTreeNode): number | null => {
  if (isNodeOfType(pattern, "Identifier")) return 1;
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return countStaticDestructureReads(pattern.left);
  }
  if (isNodeOfType(pattern, "RestElement")) {
    return null;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    if (pattern.elements.length === 0) return null;
    let count = 0;
    for (const element of pattern.elements) {
      if (!element) continue;
      const nestedCount = countStaticDestructureReads(element);
      if (nestedCount === null) return null;
      count += nestedCount;
    }
    return count > 0 ? count : null;
  }
  if (!isNodeOfType(pattern, "ObjectPattern") || pattern.properties.length === 0) return null;
  let count = 0;
  for (const property of pattern.properties) {
    if (isNodeOfType(property, "RestElement")) return null;
    if (!isNodeOfType(property, "Property") || property.computed) return null;
    const nestedCount = countStaticDestructureReads(property.value);
    if (nestedCount === null) return null;
    count += nestedCount;
  }
  return count > 0 ? count : null;
};

const analyzePropsUsage = (
  callback: EsTreeNode,
  propsSymbol: SymbolDescriptor,
  memberBindingSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): DependencyUsage => {
  const usage: DependencyUsage = { hasBareUse: false, hasMemberRead: false };
  const pendingFunctions = [callback];
  const visitedFunctions = new Set<EsTreeNode>();
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction || visitedFunctions.has(currentFunction)) continue;
    visitedFunctions.add(currentFunction);
    walkAst(currentFunction, (child: EsTreeNode) => {
      if (child !== currentFunction && isFunctionLike(child)) {
        const parent = child.parent;
        let returnCursor: EsTreeNode | null | undefined = child.parent;
        let escapesInReturnedValue = false;
        while (returnCursor && returnCursor !== currentFunction) {
          if (
            isNodeOfType(returnCursor, "ReturnStatement") ||
            (isFunctionLike(currentFunction) &&
              !isNodeOfType(currentFunction.body, "BlockStatement") &&
              currentFunction.body === returnCursor)
          ) {
            escapesInReturnedValue = true;
            break;
          }
          if (isFunctionLike(returnCursor)) break;
          returnCursor = returnCursor.parent;
        }
        const parentCallee =
          isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")
            ? stripParenExpression(parent.callee)
            : null;
        const executesImmediately = Boolean(
          (isNodeOfType(parent, "CallExpression") &&
            (parentCallee === child ||
              (callConsumesOrEscapesCallback(parent) &&
                parent.arguments.some((argument) => argument === child)))) ||
          (isNodeOfType(parent, "NewExpression") &&
            isNodeOfType(parentCallee, "Identifier") &&
            parentCallee.name === "Promise" &&
            context.scopes.isGlobalReference(parentCallee) &&
            parent.arguments?.[0] === child) ||
          (isNodeOfType(parent, "ReturnStatement") && parent.argument === child) ||
          (isFunctionLike(parent) && parent.body === child) ||
          escapesInReturnedValue,
        );
        if (!executesImmediately) {
          return false;
        }
      }
      if (isNodeOfType(child, "CallExpression")) {
        const calledFunction = resolveCallback(child.callee, context);
        if (calledFunction && calledFunction !== currentFunction)
          pendingFunctions.push(calledFunction);
        if (callConsumesOrEscapesCallback(child)) {
          for (const argument of child.arguments) {
            if (isNodeOfType(argument, "SpreadElement")) continue;
            const argumentFunction = resolveCallback(argument, context);
            if (argumentFunction) pendingFunctions.push(argumentFunction);
          }
        }
      }
      if (isNodeOfType(child, "NewExpression")) {
        const constructor = stripParenExpression(child.callee);
        if (
          isNodeOfType(constructor, "Identifier") &&
          constructor.name === "Promise" &&
          context.scopes.isGlobalReference(constructor)
        ) {
          const executor = child.arguments?.[0];
          if (executor && !isNodeOfType(executor, "SpreadElement")) {
            const executorFunction = resolveCallback(executor, context);
            if (executorFunction) pendingFunctions.push(executorFunction);
          }
        }
      }
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        const returnedFunction = resolveCallback(child.argument, context);
        if (returnedFunction) pendingFunctions.push(returnedFunction);
      }
      if (!isNodeOfType(child, "Identifier")) return;
      const directSymbol = context.scopes.symbolFor(child);
      if (directSymbol && memberBindingSymbolIds.has(directSymbol.id)) {
        usage.hasMemberRead = true;
        return;
      }
      const resolvedSymbol = resolveConstIdentifierAlias(child, context.scopes);
      if (resolvedSymbol && memberBindingSymbolIds.has(resolvedSymbol.id)) {
        usage.hasMemberRead = true;
        return;
      }
      if (resolvedSymbol?.id !== propsSymbol.id) return;
      const parent = child.parent;
      if (
        parent &&
        isNodeOfType(parent, "MemberExpression") &&
        parent.property === child &&
        !parent.computed
      ) {
        return;
      }
      if (parent && isNodeOfType(parent, "MemberExpression") && parent.object === child) {
        const expressionRoot = findTransparentExpressionRoot(parent);
        const isDirectMethodReceiver = Boolean(
          isNodeOfType(expressionRoot.parent, "CallExpression") &&
          expressionRoot.parent.callee === expressionRoot &&
          !/^on[A-Z]/.test(getStaticPropertyName(parent) ?? ""),
        );
        if (
          getStaticPropertyName(parent) === null ||
          isMemberMutation(parent) ||
          isDirectMethodReceiver
        ) {
          usage.hasBareUse = true;
        } else {
          usage.hasMemberRead = true;
        }
        return;
      }
      if (
        parent &&
        isNodeOfType(parent, "Property") &&
        parent.key === child &&
        !parent.computed &&
        !parent.shorthand
      ) {
        return;
      }
      if (isConstAliasInitializer(child, propsSymbol, context)) return;
      if (parent && isNodeOfType(parent, "VariableDeclarator") && parent.init === child) {
        const staticReadCount = countStaticDestructureReads(parent.id);
        if (staticReadCount !== null) {
          usage.hasMemberRead = true;
          return;
        }
      }
      usage.hasBareUse = true;
    });
  }
  return usage;
};

const resolveCallback = (
  callbackExpression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const callback = stripParenExpression(callbackExpression);
  if (isFunctionLike(callback)) return callback;
  if (isNodeOfType(callback, "MemberExpression")) {
    const methodName = getStaticPropertyName(callback);
    const receiver = stripParenExpression(callback.object);
    if (!methodName || !isNodeOfType(receiver, "Identifier")) return null;
    const receiverSymbol = context.scopes.symbolFor(receiver);
    const initializer = receiverSymbol?.initializer
      ? stripParenExpression(receiverSymbol.initializer)
      : null;
    if (!isNodeOfType(initializer, "ObjectExpression")) return null;
    for (const property of initializer.properties.toReversed()) {
      if (
        !isNodeOfType(property, "Property") ||
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== methodName
      ) {
        continue;
      }
      const value = stripParenExpression(property.value);
      return isFunctionLike(value) ? value : null;
    }
    return null;
  }
  if (!isNodeOfType(callback, "Identifier")) return null;
  const callbackSymbol = resolveConstIdentifierAlias(callback, context.scopes);
  if (!callbackSymbol?.initializer) return null;
  const initializer = stripParenExpression(callbackSymbol.initializer);
  return isFunctionLike(initializer) ? initializer : null;
};

const findEnclosingComponent = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent;
  while (ancestor && !isFunctionLike(ancestor)) ancestor = ancestor.parent;
  if (!ancestor) return null;
  const displayName = componentOrHookDisplayNameForFunction(ancestor);
  return displayName && isUppercaseName(displayName) ? ancestor : null;
};

export const noWholeObjectDepWithMemberReads = defineRule({
  id: "no-whole-object-dep-with-member-reads",
  title: "Whole props object in deps while only members are read",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Destructure the fields you read and depend on those bindings instead of the whole props object.",
  create: (context: RuleContext) => {
    const memberBindingIdsByPropsSymbol = new Map<number, ReadonlySet<number>>();
    const usageByCallback = new WeakMap<EsTreeNode, Map<number, DependencyUsage>>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isReactApiCall(node, IDENTITY_SENSITIVE_HOOKS_WITH_DEPS, context.scopes, {
            resolveNamedAliases: true,
          })
        ) {
          return;
        }
        const callbackIndex = isReactApiCall(node, "useImperativeHandle", context.scopes, {
          resolveNamedAliases: true,
        })
          ? 1
          : 0;
        const argumentsList = node.arguments ?? [];
        if (argumentsList.length < callbackIndex + 2) return;
        const callback = resolveCallback(argumentsList[callbackIndex], context);
        if (!callback) return;
        const dependencyArray = stripParenExpression(argumentsList[callbackIndex + 1]);
        if (!isNodeOfType(dependencyArray, "ArrayExpression")) return;
        const component = findEnclosingComponent(node);
        if (!component) return;
        const propsSymbol = getPropsObjectSymbol(component, context);
        if (!propsSymbol) return;
        const memberBindingSymbolIds =
          memberBindingIdsByPropsSymbol.get(propsSymbol.id) ??
          collectPropsMemberBindingSymbolIds(propsSymbol, context);
        memberBindingIdsByPropsSymbol.set(propsSymbol.id, memberBindingSymbolIds);
        const cachedUsageByProps = usageByCallback.get(callback) ?? new Map();
        usageByCallback.set(callback, cachedUsageByProps);
        const usage =
          cachedUsageByProps.get(propsSymbol.id) ??
          analyzePropsUsage(callback, propsSymbol, memberBindingSymbolIds, context);
        cachedUsageByProps.set(propsSymbol.id, usage);
        if (usage.hasBareUse || !usage.hasMemberRead) return;
        for (const element of dependencyArray.elements ?? []) {
          if (!element) continue;
          const dependency = stripParenExpression(element);
          if (!isNodeOfType(dependency, "Identifier")) continue;
          if (resolveConstIdentifierAlias(dependency, context.scopes)?.id !== propsSymbol.id)
            continue;
          context.report({
            node: element,
            message: `This hook depends on the whole "${dependency.name}" object but only reads its properties; depend on the specific fields instead.`,
          });
        }
      },
    };
  },
});
