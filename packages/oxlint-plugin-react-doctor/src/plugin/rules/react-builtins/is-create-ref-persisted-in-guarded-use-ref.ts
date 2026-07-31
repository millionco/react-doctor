import type { ControlFlowAnalysis } from "../../semantic/control-flow-graph.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const getEmptyRefValueKind = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): "false" | "null" | "undefined" | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    if (candidate.value === null) return "null";
    if (candidate.value === false) return "false";
  }
  if (
    isNodeOfType(candidate, "Identifier") &&
    candidate.name === "undefined" &&
    !scopes.symbolFor(candidate)
  ) {
    return "undefined";
  }
  return null;
};

const isCurrentMemberForSymbol = (
  expression: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(candidate.object);
  return isNodeOfType(receiver, "Identifier") && scopes.symbolFor(receiver)?.id === symbol.id;
};

const findPersistenceAssignment = (
  createRefCall: EsTreeNodeOfType<"CallExpression">,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  let current = findTransparentExpressionRoot(createRefCall);
  while (current.parent) {
    if (
      isNodeOfType(current.parent, "AssignmentExpression") &&
      current.parent.operator === "=" &&
      current.parent.right === current
    ) {
      return current.parent;
    }
    const property = current.parent;
    if (!isNodeOfType(property, "Property") || property.value !== current) return null;
    const objectExpression = property.parent;
    if (!isNodeOfType(objectExpression, "ObjectExpression")) return null;
    current = findTransparentExpressionRoot(objectExpression);
  }
  return null;
};

const findGuard = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
): EsTreeNodeOfType<"IfStatement"> | null => {
  const expressionStatement = assignment.parent;
  if (!isNodeOfType(expressionStatement, "ExpressionStatement")) return null;
  const container = expressionStatement.parent;
  if (isNodeOfType(container, "IfStatement") && container.consequent === expressionStatement) {
    return container;
  }
  if (
    !isNodeOfType(container, "BlockStatement") ||
    container.body.length !== 1 ||
    container.body[0] !== expressionStatement ||
    !isNodeOfType(container.parent, "IfStatement") ||
    container.parent.consequent !== container
  ) {
    return null;
  }
  return container.parent;
};

const doesGuardProveEmptyRef = (
  guard: EsTreeNodeOfType<"IfStatement">,
  symbol: SymbolDescriptor,
  initialValueKind: "false" | "null" | "undefined",
  scopes: ScopeAnalysis,
): boolean => {
  const test = stripParenExpression(guard.test);
  if (
    isNodeOfType(test, "UnaryExpression") &&
    test.operator === "!" &&
    isCurrentMemberForSymbol(test.argument, symbol, scopes)
  ) {
    return true;
  }
  if (!isNodeOfType(test, "BinaryExpression") || !["==", "==="].includes(test.operator)) {
    return false;
  }
  const comparedValueKind = isCurrentMemberForSymbol(test.left, symbol, scopes)
    ? getEmptyRefValueKind(test.right, scopes)
    : isCurrentMemberForSymbol(test.right, symbol, scopes)
      ? getEmptyRefValueKind(test.left, scopes)
      : null;
  if (!comparedValueKind) return false;
  if (test.operator === "===") return comparedValueKind === initialValueKind;
  return (
    (comparedValueKind === "null" || comparedValueKind === "undefined") &&
    (initialValueKind === "null" || initialValueKind === "undefined")
  );
};

const isDirectCurrentWrite = (
  identifier: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const receiverRoot = findTransparentExpressionRoot(identifier);
  const memberExpression = receiverRoot.parent;
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    memberExpression.object !== receiverRoot ||
    !isCurrentMemberForSymbol(memberExpression, symbol, scopes)
  ) {
    return null;
  }
  const memberRoot = findTransparentExpressionRoot(memberExpression);
  const parent = memberRoot.parent;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === memberRoot) {
    return parent;
  }
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === memberRoot) {
    return parent;
  }
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "delete" &&
    parent.argument === memberRoot
  ) {
    return parent;
  }
  return null;
};

const isKnownPersistentRefReference = (
  identifier: EsTreeNode,
  symbol: SymbolDescriptor,
  aliasSymbolIds: Set<number>,
  scopes: ScopeAnalysis,
): boolean => {
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const parent = referenceRoot.parent;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === referenceRoot &&
    isCurrentMemberForSymbol(parent, symbol, scopes)
  ) {
    return true;
  }
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== referenceRoot ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return false;
  }
  const aliasSymbol = scopes.symbolFor(parent.id);
  return Boolean(aliasSymbol && aliasSymbolIds.has(aliasSymbol.id));
};

export const isCreateRefPersistedInGuardedUseRef = (
  createRefCall: EsTreeNodeOfType<"CallExpression">,
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  cfg: ControlFlowAnalysis,
): boolean => {
  const assignment = findPersistenceAssignment(createRefCall);
  if (
    !assignment ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    getStaticPropertyName(assignment.left) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(assignment.left.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = scopes.symbolFor(receiver);
  const refSymbol = resolveReactRefSymbol(assignment.left, scopes, {
    resolveNamedAliases: true,
  });
  if (
    !receiverSymbol ||
    !refSymbol ||
    receiverSymbol.id !== refSymbol.id ||
    refSymbol.kind !== "const" ||
    !refSymbol.initializer ||
    findEnclosingFunction(refSymbol.bindingIdentifier) !== enclosingFunction ||
    !refSymbol.references.every((reference) => reference.flag === "read")
  ) {
    return false;
  }
  const refInitializer = stripParenExpression(refSymbol.initializer);
  if (
    !isNodeOfType(refInitializer, "CallExpression") ||
    !cfg.isUnconditionalFromEntry(refInitializer) ||
    refInitializer.arguments.length > 1
  ) {
    return false;
  }
  const initialValueKind =
    refInitializer.arguments.length === 0
      ? "undefined"
      : getEmptyRefValueKind(refInitializer.arguments[0], scopes);
  if (!initialValueKind) return false;
  const guard = findGuard(assignment);
  if (!guard || !doesGuardProveEmptyRef(guard, refSymbol, initialValueKind, scopes)) return false;
  const aliasSymbols = collectConstAliasSymbols(refSymbol, scopes);
  const aliasSymbolIds = new Set(aliasSymbols.map((aliasSymbol) => aliasSymbol.id));
  for (const aliasSymbol of aliasSymbols) {
    for (const reference of aliasSymbol.references) {
      if (
        reference.flag !== "read" ||
        !isKnownPersistentRefReference(reference.identifier, aliasSymbol, aliasSymbolIds, scopes)
      ) {
        return false;
      }
      const write = isDirectCurrentWrite(reference.identifier, aliasSymbol, scopes);
      if (write && write !== assignment) return false;
    }
  }
  return true;
};
