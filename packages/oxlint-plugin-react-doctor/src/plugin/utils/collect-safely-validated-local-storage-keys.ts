import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isGlobalMethodCall } from "./is-global-method-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ValidatedLocalStorageAnalysisInput {
  readonly programNode: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly resolveKey: (keyNode: EsTreeNode) => string | null;
}

const isLocalStorageCall = (node: EsTreeNode, methodName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "localStorage" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === methodName
  );
};

const catchReturnsFallback = (tryStatement: EsTreeNodeOfType<"TryStatement">): boolean => {
  const handler = tryStatement.handler;
  if (!handler) return false;
  let hasReturn = false;
  let hasThrow = false;
  walkAst(handler.body, (child) => {
    if (isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) hasReturn = true;
    if (isNodeOfType(child, "ThrowStatement")) hasThrow = true;
  });
  return hasReturn && !hasThrow;
};

const resolveValidatorFunction = (callee: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  const unwrappedCallee = stripParenExpression(callee);
  if (!isNodeOfType(unwrappedCallee, "Identifier")) return null;
  const symbol = scopes.symbolFor(unwrappedCallee);
  if (!symbol) return null;
  const candidate = symbol.kind === "function" ? symbol.declarationNode : symbol.initializer;
  return isFunctionLike(candidate) ? candidate : null;
};

const validatorChecksPayloadProperties = (
  validatorFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(validatorFunction)) return false;
  const firstParameter = validatorFunction.params?.[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(firstParameter);
  if (!parameterSymbol) return false;
  const payloadSymbolIds = new Set([parameterSymbol.id]);
  let hasPropertyTypeCheck = false;
  walkAst(validatorFunction.body, (child) => {
    if (isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.init
    ) {
      const initializer = stripParenExpression(child.init);
      if (isNodeOfType(initializer, "Identifier")) {
        const initializerSymbol = scopes.symbolFor(initializer);
        if (initializerSymbol && payloadSymbolIds.has(initializerSymbol.id)) {
          const aliasSymbol = scopes.symbolFor(child.id);
          if (aliasSymbol) payloadSymbolIds.add(aliasSymbol.id);
        }
      }
    }
    if (!isNodeOfType(child, "UnaryExpression") || child.operator !== "typeof") return;
    const checkedValue = stripParenExpression(child.argument);
    if (!isNodeOfType(checkedValue, "MemberExpression")) return;
    const receiver = stripParenExpression(checkedValue.object);
    if (!isNodeOfType(receiver, "Identifier")) return;
    const receiverSymbol = scopes.symbolFor(receiver);
    if (receiverSymbol && payloadSymbolIds.has(receiverSymbol.id)) hasPropertyTypeCheck = true;
  });
  return hasPropertyTypeCheck;
};

const incrementCount = (counts: Map<string, number>, keyValue: string): void => {
  counts.set(keyValue, (counts.get(keyValue) ?? 0) + 1);
};

const isReturnedExpression = (expression: EsTreeNode): boolean => {
  const parent = expression.parent;
  return Boolean(
    parent && isNodeOfType(parent, "ReturnStatement") && parent.argument === expression,
  );
};

export const collectSafelyValidatedLocalStorageKeys = ({
  programNode,
  scopes,
  resolveKey,
}: ValidatedLocalStorageAnalysisInput): ReadonlySet<string> => {
  const readCountsByKey = new Map<string, number>();
  const safeReadCountsByKey = new Map<string, number>();
  const safeReadSymbolIds = new Set<number>();
  walkAst(programNode, (child) => {
    if (!isNodeOfType(child, "CallExpression") || !isLocalStorageCall(child, "getItem")) {
      return;
    }
    const keyArgument = child.arguments?.[0];
    if (!keyArgument) return;
    const keyValue = resolveKey(keyArgument);
    if (keyValue !== null) incrementCount(readCountsByKey, keyValue);
  });
  walkAst(programNode, (child) => {
    if (!isNodeOfType(child, "TryStatement") || !catchReturnsFallback(child)) return;
    const rawValueKeys = new Map<number, string>();
    const parsedValueSources = new Map<number, number>();
    walkAst(child.block, (tryChild) => {
      if (isFunctionLike(tryChild)) return false;
      if (
        isNodeOfType(tryChild, "VariableDeclarator") &&
        isNodeOfType(tryChild.id, "Identifier") &&
        tryChild.init
      ) {
        const initializer = stripParenExpression(tryChild.init);
        if (
          isNodeOfType(initializer, "CallExpression") &&
          isLocalStorageCall(initializer, "getItem")
        ) {
          const keyArgument = initializer.arguments?.[0];
          const bindingSymbol = scopes.symbolFor(tryChild.id);
          if (keyArgument && bindingSymbol) {
            const keyValue = resolveKey(keyArgument);
            if (keyValue !== null) rawValueKeys.set(bindingSymbol.id, keyValue);
          }
        }
        if (
          isNodeOfType(initializer, "CallExpression") &&
          isGlobalMethodCall(initializer, "JSON", "parse")
        ) {
          const rawValueArgument = initializer.arguments?.[0];
          const parsedValueSymbol = scopes.symbolFor(tryChild.id);
          if (
            rawValueArgument &&
            isNodeOfType(rawValueArgument, "Identifier") &&
            parsedValueSymbol
          ) {
            const rawValueSymbol = scopes.symbolFor(rawValueArgument);
            if (rawValueSymbol && rawValueKeys.has(rawValueSymbol.id)) {
              parsedValueSources.set(parsedValueSymbol.id, rawValueSymbol.id);
            }
          }
        }
      }
      if (!isNodeOfType(tryChild, "ConditionalExpression") || !isReturnedExpression(tryChild)) {
        return;
      }
      const test = stripParenExpression(tryChild.test);
      if (!isNodeOfType(test, "CallExpression")) return;
      const testedValue = test.arguments?.[0];
      if (!testedValue || !isNodeOfType(testedValue, "Identifier")) return;
      const parsedValueSymbol = scopes.symbolFor(testedValue);
      if (!parsedValueSymbol) return;
      const rawValueSymbolId = parsedValueSources.get(parsedValueSymbol.id);
      if (rawValueSymbolId === undefined) return;
      const returnedValue = stripParenExpression(tryChild.consequent);
      if (
        !isNodeOfType(returnedValue, "Identifier") ||
        scopes.symbolFor(returnedValue)?.id !== parsedValueSymbol.id
      ) {
        return;
      }
      const validatorFunction = resolveValidatorFunction(test.callee, scopes);
      if (!validatorFunction || !validatorChecksPayloadProperties(validatorFunction, scopes)) {
        return;
      }
      const keyValue = rawValueKeys.get(rawValueSymbolId);
      if (keyValue === undefined || safeReadSymbolIds.has(rawValueSymbolId)) return;
      safeReadSymbolIds.add(rawValueSymbolId);
      incrementCount(safeReadCountsByKey, keyValue);
    });
  });
  const safeKeys = new Set<string>();
  for (const [keyValue, readCount] of readCountsByKey) {
    if (safeReadCountsByKey.get(keyValue) === readCount) safeKeys.add(keyValue);
  }
  return safeKeys;
};
