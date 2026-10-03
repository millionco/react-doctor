import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isDescendantWithoutFunctionBoundary } from "../../../utils/is-descendant-without-function-boundary.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";

interface LastItemGuard {
  propertyName: string;
  target: EsTreeNode;
}

const resolveImmutableAlias = (node: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode => {
  let current = stripParenExpression(node);
  const seen = new Set<SymbolDescriptor>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (!symbol || seen.has(symbol)) break;
    if (symbol.references.some((reference) => reference.flag !== "read")) break;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) break;
    seen.add(symbol);
    current = stripParenExpression(initializer);
  }
  return current;
};

const isFixedStringTarget = (
  node: EsTreeNode,
  componentScope: SymbolDescriptor["scope"],
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "Literal")) return typeof node.value === "string";
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (
    !symbol ||
    symbol.kind !== "parameter" ||
    symbol.scope !== componentScope ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "ObjectPattern")) return false;
  const property = declaration.properties.find(
    (candidate) =>
      isNodeOfType(candidate, "Property") && candidate.value === symbol.bindingIdentifier,
  );
  const annotation = declaration.typeAnnotation?.typeAnnotation;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    !isNodeOfType(property.key, "Identifier") ||
    !isNodeOfType(annotation, "TSTypeLiteral")
  ) {
    return false;
  }
  const propertyName = property.key.name;
  return annotation.members.some(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      !member.computed &&
      isNodeOfType(member.key, "Identifier") &&
      member.key.name === propertyName &&
      isNodeOfType(member.typeAnnotation?.typeAnnotation, "TSStringKeyword"),
  );
};

const isLastItemSelection = (
  node: EsTreeNode,
  state: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const selection = resolveImmutableAlias(node, scopes);
  if (
    !isNodeOfType(selection, "MemberExpression") ||
    !selection.computed ||
    scopes.symbolFor(stripParenExpression(selection.object)) !== state
  ) {
    return false;
  }
  const index = stripParenExpression(selection.property);
  if (!isNodeOfType(index, "BinaryExpression") || index.operator !== "-") return false;
  const length = stripParenExpression(index.left);
  return (
    isNodeOfType(index.right, "Literal") &&
    index.right.value === 1 &&
    isNodeOfType(length, "MemberExpression") &&
    getStaticPropertyName(length) === "length" &&
    scopes.symbolFor(stripParenExpression(length.object)) === state
  );
};

const getLastItemGuard = (
  test: EsTreeNode,
  state: SymbolDescriptor,
  scopes: ScopeAnalysis,
): LastItemGuard | null => {
  const comparison = stripParenExpression(test);
  if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "===") return null;
  for (const [selection, targetNode] of [
    [comparison.left, comparison.right],
    [comparison.right, comparison.left],
  ]) {
    const member = stripParenExpression(selection);
    const target = resolveImmutableAlias(targetNode, scopes);
    if (
      !isNodeOfType(member, "MemberExpression") ||
      !isLastItemSelection(member.object, state, scopes) ||
      !isFixedStringTarget(target, state.scope, scopes)
    ) {
      continue;
    }
    const propertyName = getStaticPropertyName(member);
    if (propertyName !== null) return { propertyName, target };
  }
  return null;
};

const hasOnlyReadSelections = (
  state: SymbolDescriptor,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const pending = new Set([state]);
  for (const symbol of pending) {
    for (const reference of symbol.references) {
      if (!isAstDescendant(reference.identifier, callback)) continue;
      const root = findTransparentExpressionRoot(reference.identifier);
      const member = root.parent;
      if (symbol !== state && isNodeOfType(member, "VariableDeclarator") && member.init === root) {
        const alias = scopes.symbolFor(member.id);
        if (!alias || getDirectUnreassignedInitializer(alias) !== member.init) return false;
        pending.add(alias);
        continue;
      }
      if (
        symbol !== state &&
        isNodeOfType(member, "SpreadElement") &&
        isNodeOfType(member.parent, "ObjectExpression")
      ) {
        continue;
      }
      if (
        reference.flag !== "read" ||
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        isWithinAssignmentTarget(member)
      ) {
        return false;
      }
      if (symbol !== state || getStaticPropertyName(member) === "length") continue;
      if (!isLastItemSelection(member, state, scopes)) return false;
      const selectionRoot = findTransparentExpressionRoot(member);
      const parent = selectionRoot.parent;
      if (isNodeOfType(parent, "MemberExpression") && parent.object === selectionRoot) continue;
      if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== selectionRoot)
        return false;
      const alias = scopes.symbolFor(parent.id);
      if (!alias || getDirectUnreassignedInitializer(alias) !== parent.init) return false;
      pending.add(alias);
    }
  }
  return true;
};

const getPureUpdaterReturn = (updater: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(updater) || updater.async || updater.generator) return null;
  if (!isNodeOfType(updater.body, "BlockStatement")) return stripParenExpression(updater.body);
  if (updater.body.body.length !== 1) return null;
  const statement = updater.body.body[0];
  return isNodeOfType(statement, "ReturnStatement") && statement.argument
    ? stripParenExpression(statement.argument)
    : null;
};

const preservesLastItem = (
  updater: EsTreeNode,
  returned: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(updater) || updater.params.length !== 1) return false;
  const parameter = updater.params[0];
  if (!isNodeOfType(parameter, "Identifier") || !isNodeOfType(returned, "CallExpression"))
    return false;
  const callee = stripParenExpression(returned.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "slice" ||
    scopes.symbolFor(stripParenExpression(callee.object)) !== scopes.symbolFor(parameter) ||
    returned.arguments.length !== 1
  ) {
    return false;
  }
  const start = stripParenExpression(returned.arguments[0]);
  return (
    isNodeOfType(start, "UnaryExpression") &&
    start.operator === "-" &&
    isNodeOfType(start.argument, "Literal") &&
    start.argument.value === 1
  );
};

const establishesLastItem = (
  value: EsTreeNode,
  guard: LastItemGuard,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(value, "ArrayExpression")) return false;
  const tail = value.elements.at(-1);
  if (!tail) return false;
  const property = getStaticObjectPropertyValue(tail, guard.propertyName);
  if (!property) return false;
  const written = resolveImmutableAlias(property, scopes);
  return (
    (isNodeOfType(written, "Literal") &&
      isNodeOfType(guard.target, "Literal") &&
      written.value === guard.target.value) ||
    (isNodeOfType(written, "Identifier") &&
      isNodeOfType(guard.target, "Identifier") &&
      scopes.symbolFor(written) === scopes.symbolFor(guard.target))
  );
};

export const doesLastItemGuardConverge = (
  callback: EsTreeNode,
  binding: UseStateBinding,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return false;
  }
  if (!isNodeOfType(binding.declarator.id, "ArrayPattern")) return false;
  const [stateNode, setterNode] = binding.declarator.id.elements;
  const state = stateNode ? scopes.symbolFor(stateNode) : null;
  const setter = setterNode ? scopes.symbolFor(setterNode) : null;
  if (!state || !setter || !hasOnlyReadSelections(state, callback, scopes)) return false;
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const reference of setter.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== root) return false;
    if (isAstDescendant(call, callback)) calls.push(call);
  }
  if (calls.length === 0) return false;
  return callback.body.body.some((statement) => {
    if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
    const exit = isNodeOfType(statement.consequent, "BlockStatement")
      ? statement.consequent.body.length === 1 && statement.consequent.body[0]
      : statement.consequent;
    if (!exit || !isNodeOfType(exit, "ReturnStatement") || exit.argument) return false;
    if (calls.some((call) => getNodeStartIndex(call) <= getNodeStartIndex(statement))) return false;
    const guard = getLastItemGuard(statement.test, state, scopes);
    if (!guard) return false;
    let establishesGuard = false;
    const allWritesConverge = calls.every((call) => {
      if (call.arguments.length !== 1) return false;
      const argument = stripParenExpression(call.arguments[0]);
      const returned = isFunctionLike(argument) ? getPureUpdaterReturn(argument) : argument;
      if (!returned) return false;
      if (!isDescendantWithoutFunctionBoundary(call, callback)) {
        return preservesLastItem(argument, returned, scopes);
      }
      if (!establishesLastItem(returned, guard, scopes)) return false;
      establishesGuard = true;
      return true;
    });
    return establishesGuard && allWritesConverge;
  });
};
