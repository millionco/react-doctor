import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
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

interface DependencyUsage {
  hasBareUse: boolean;
  hasMemberRead: boolean;
}

const getPropsObjectSymbol = (
  componentFunction: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isFunctionLike(componentFunction)) return null;
  const firstParameter = componentFunction.params?.[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return null;
  return context.scopes.symbolFor(firstParameter);
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
  for (const reference of propsSymbol.references) {
    const identifier = reference.identifier;
    const parent = identifier.parent;
    if (parent && isNodeOfType(parent, "MemberExpression") && parent.object === identifier) {
      if (getStaticPropertyName(parent) === null || isMemberMutation(parent)) continue;
      const expressionRoot = findTransparentExpressionRoot(parent);
      const declarator = expressionRoot.parent;
      if (
        isNodeOfType(declarator, "VariableDeclarator") &&
        declarator.init === expressionRoot &&
        isNodeOfType(declarator.id, "Identifier")
      ) {
        const bindingSymbol = context.scopes.symbolFor(declarator.id);
        if (bindingSymbol) symbolIds.add(bindingSymbol.id);
      }
      continue;
    }
    if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== identifier) continue;
    if (!isNodeOfType(parent.id, "ObjectPattern")) continue;
    for (const property of parent.id.properties) {
      if (!isNodeOfType(property, "Property") || property.computed) continue;
      const binding = isNodeOfType(property.value, "AssignmentPattern")
        ? property.value.left
        : property.value;
      if (!isNodeOfType(binding, "Identifier")) continue;
      const bindingSymbol = context.scopes.symbolFor(binding);
      if (bindingSymbol) symbolIds.add(bindingSymbol.id);
    }
  }
  return symbolIds;
};

const countStaticDestructureReads = (pattern: EsTreeNode): number | null => {
  if (!isNodeOfType(pattern, "ObjectPattern") || pattern.properties.length === 0) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) return null;
  }
  return pattern.properties.length;
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
              (isNodeOfType(parentCallee, "MemberExpression") &&
                SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(parentCallee) ?? "") &&
                parent.arguments?.[0] === child))) ||
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
        const callCallee = stripParenExpression(child.callee);
        if (
          isNodeOfType(callCallee, "MemberExpression") &&
          SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callCallee) ?? "")
        ) {
          const callbackArgument = child.arguments?.[0];
          if (callbackArgument && !isNodeOfType(callbackArgument, "SpreadElement")) {
            const callbackFunction = resolveCallback(callbackArgument, context);
            if (callbackFunction) pendingFunctions.push(callbackFunction);
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
        if (getStaticPropertyName(parent) === null || isMemberMutation(parent)) {
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
