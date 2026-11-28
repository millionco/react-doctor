import { HOOK_FREE_DATA_EXPRESSION_MAX_DEPTH } from "../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

type ValueKind = "primitive" | "data" | "unknown";

const hasPrimitiveLiteralValue = (node: EsTreeNodeOfType<"Literal">): boolean =>
  !("regex" in node) &&
  ((node.value === null && !("bigint" in node)) ||
    typeof node.value === "string" ||
    typeof node.value === "boolean" ||
    typeof node.value === "number" ||
    typeof node.value === "bigint");

const dynamicScopeByProgram = new WeakMap<EsTreeNode, boolean>();

const hasDynamicScope = (program: EsTreeNode): boolean => {
  if (isNodeOfType(program, "Program") && program.sourceType === "module") return false;
  const cached = dynamicScopeByProgram.get(program);
  if (cached !== undefined) return cached;
  let hasWithStatement = false;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "WithStatement")) hasWithStatement = true;
    return !hasWithStatement;
  });
  dynamicScopeByProgram.set(program, hasWithStatement);
  return hasWithStatement;
};

const combineValues = (left: ValueKind, right: ValueKind): ValueKind => {
  if (left === "unknown" || right === "unknown") return "unknown";
  return left === "primitive" && right === "primitive" ? "primitive" : "data";
};

const makeValueReader = (
  scopes: ScopeAnalysis,
  parameters: ReadonlyMap<SymbolDescriptor, ValueKind>,
): ((expression: EsTreeNode) => ValueKind | null) => {
  const previouslyRead = new WeakMap<EsTreeNode, ValueKind | null>();
  let depth = 0;

  const read = (expression: EsTreeNode): ValueKind | null => {
    const node = stripParenExpression(expression);
    const cached = previouslyRead.get(node);
    if (cached !== undefined) return cached;
    if (depth >= HOOK_FREE_DATA_EXPRESSION_MAX_DEPTH) return null;
    previouslyRead.set(node, null);
    depth += 1;
    const result = resolve(node);
    depth -= 1;
    previouslyRead.set(node, result);
    return result;
  };

  const readObjectEntries = (entries: ReadonlyArray<EsTreeNode | null>): ValueKind | null => {
    let result: ValueKind = "data";
    for (const entry of entries) {
      if (!entry) continue;
      const kind = read(entry);
      if (kind === null) return null;
      result = combineValues(result, kind);
    }
    return result;
  };

  const resolve = (node: EsTreeNode): ValueKind | null => {
    if (isNodeOfType(node, "Literal")) {
      return hasPrimitiveLiteralValue(node) ? "primitive" : "data";
    }
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (!symbol) return null;
      const parameter = parameters.get(symbol);
      if (parameter !== undefined) return parameter;
      if (symbol.kind === "parameter") return "unknown";
      const initializer = getDirectConstInitializer(symbol);
      if (!initializer || getNodeStartIndex(initializer) >= getNodeStartIndex(node)) return null;
      return read(initializer) ?? "unknown";
    }
    if (isNodeOfType(node, "TemplateLiteral")) {
      return node.expressions.every((value) => read(value) === "primitive") ? "primitive" : null;
    }
    if (isNodeOfType(node, "UnaryExpression")) {
      if (node.operator === "delete") return null;
      const argument = read(node.argument);
      return argument !== null &&
        (argument === "primitive" ||
          node.operator === "!" ||
          node.operator === "typeof" ||
          node.operator === "void")
        ? "primitive"
        : null;
    }
    if (isNodeOfType(node, "BinaryExpression")) {
      if (node.operator === "in" || node.operator === "instanceof") return null;
      const left = read(node.left);
      const right = read(node.right);
      return left !== null &&
        right !== null &&
        (node.operator === "===" ||
          node.operator === "!==" ||
          (left === "primitive" && right === "primitive"))
        ? "primitive"
        : null;
    }
    if (isNodeOfType(node, "LogicalExpression")) {
      const leftExpression = stripParenExpression(node.left);
      if (isNodeOfType(leftExpression, "Literal") && hasPrimitiveLiteralValue(leftExpression)) {
        const shortCircuits =
          node.operator === "&&"
            ? !leftExpression.value
            : node.operator === "||"
              ? Boolean(leftExpression.value)
              : leftExpression.value !== null && leftExpression.value !== undefined;
        return read(shortCircuits ? leftExpression : node.right);
      }
      const left = read(node.left);
      const right = read(node.right);
      return left === null || right === null ? null : combineValues(left, right);
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      const test = stripParenExpression(node.test);
      if (isNodeOfType(test, "Literal") && hasPrimitiveLiteralValue(test)) {
        return read(test.value ? node.consequent : node.alternate);
      }
      if (read(test) === null) return null;
      const consequent = read(node.consequent);
      const alternate = read(node.alternate);
      return consequent === null || alternate === null
        ? null
        : combineValues(consequent, alternate);
    }
    if (isNodeOfType(node, "ArrayExpression")) return readObjectEntries(node.elements);
    if (isNodeOfType(node, "ObjectExpression")) {
      const values: EsTreeNode[] = [];
      for (const property of node.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.computed ||
          property.method ||
          getStaticPropertyKeyName(property) === "__proto__"
        ) {
          return null;
        }
        values.push(property.value);
      }
      return readObjectEntries(values);
    }
    return null;
  };

  return read;
};

export const isAliasedHookFreeDataFunction = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const alias = scopes.symbolFor(callee);
  const initializer = alias ? getDirectConstInitializer(alias) : null;
  if (
    !initializer ||
    !isNodeOfType(stripParenExpression(initializer), "Identifier") ||
    alias?.references.some(({ flag }) => flag !== "read")
  ) {
    return false;
  }
  const target = resolveConstIdentifierAlias(callee, scopes);
  const targetInitializer = target ? getDirectConstInitializer(target) : null;
  if (!targetInitializer || target?.references.some(({ flag }) => flag !== "read")) return false;
  const localFunction = stripParenExpression(targetInitializer);
  if (!isFunctionLike(localFunction) || localFunction.async || localFunction.generator)
    return false;
  const returned = getSingleReturnExpression(localFunction);
  if (!returned || hasDynamicScope(scopes.rootScope.node)) return false;

  const parameters = new Map<SymbolDescriptor, ValueKind>();
  const readArgument = makeValueReader(scopes, new Map());
  const hasSpread = call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"));
  for (const [index, parameter] of localFunction.params.entries()) {
    if (!isNodeOfType(parameter, "Identifier") || parameter.name === "this") return false;
    const symbol = scopes.symbolFor(parameter);
    if (!symbol) return false;
    const argument = call.arguments[index];
    const value = hasSpread
      ? "unknown"
      : argument
        ? (readArgument(argument) ?? "unknown")
        : "primitive";
    parameters.set(symbol, value);
  }
  const value = makeValueReader(scopes, parameters)(returned);
  return value === "primitive" || value === "data";
};
