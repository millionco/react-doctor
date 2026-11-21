import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const getSingleStatement = (node: EsTreeNode): EsTreeNode | undefined =>
  isNodeOfType(node, "BlockStatement") ? (node.body.length === 1 ? node.body[0] : undefined) : node;

const getOwnEntryWrite = (identifier: EsTreeNode, fieldName: string): EsTreeNode | undefined => {
  const field = identifier.parent;
  const entry = field?.parent;
  const write = entry?.parent;
  if (
    !isNodeOfType(field, "MemberExpression") ||
    field.optional ||
    field.object !== identifier ||
    getStaticPropertyName(field) !== fieldName ||
    !isNodeOfType(entry, "MemberExpression") ||
    entry.optional ||
    entry.object !== field
  )
    return undefined;
  if (isNodeOfType(write, "AssignmentExpression") && write.operator === "=" && write.left === entry)
    return write;
  return isNodeOfType(write, "UnaryExpression") &&
    write.operator === "delete" &&
    write.argument === entry
    ? write
    : undefined;
};

export const isGuardedCopyOnWriteDeletion = (
  target: EsTreeNode,
  updater: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(target, "MemberExpression") ||
    !isNodeOfType(updater, "ArrowFunctionExpression")
  )
    return false;
  const field = target.object;
  if (!isNodeOfType(field, "MemberExpression") || !isNodeOfType(field.object, "Identifier"))
    return false;
  const fieldName = getStaticPropertyName(field);
  if (!fieldName || fieldName === "__proto__") return false;
  const draft = scopes.symbolFor(field.object);
  const [parameter] = updater.params;
  if (draft?.kind !== "let" || !draft.initializer || !isNodeOfType(parameter, "Identifier"))
    return false;
  if (
    !isNodeOfType(draft.declarationNode, "VariableDeclarator") ||
    draft.declarationNode.id !== draft.bindingIdentifier
  )
    return false;
  const previous = scopes.symbolFor(parameter);
  if (
    !previous ||
    scopes.symbolFor(stripParenExpression(draft.initializer)) !== previous ||
    findEnclosingFunction(draft.bindingIdentifier) !== updater ||
    previous.references.some((reference) => reference.flag !== "read")
  )
    return false;
  const writes = draft.references.filter((reference) => reference.flag !== "read");
  if (writes.length !== 1) return false;
  const assignment = writes[0].identifier.parent;
  const assignmentStatement = assignment?.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== writes[0].identifier ||
    !isNodeOfType(assignmentStatement, "ExpressionStatement")
  )
    return false;
  const branch = isNodeOfType(assignmentStatement.parent, "BlockStatement")
    ? assignmentStatement.parent
    : assignmentStatement;
  const guard = branch.parent;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== branch ||
    guard.alternate ||
    getSingleStatement(branch) !== assignmentStatement ||
    !isNodeOfType(guard.parent, "BlockStatement")
  )
    return false;
  const condition = stripParenExpression(guard.test);
  if (!isNodeOfType(condition, "BinaryExpression") || condition.operator !== "===") return false;
  const left = stripParenExpression(condition.left);
  const right = stripParenExpression(condition.right);
  const draftCheck = scopes.symbolFor(left) === draft ? left : right;
  if (
    scopes.symbolFor(draftCheck) !== draft ||
    scopes.symbolFor(draftCheck === left ? right : left) !== previous
  )
    return false;

  const copied = stripParenExpression(assignment.right);
  if (!isNodeOfType(copied, "ObjectExpression") || copied.properties.length !== 2) return false;
  const [outerSpread, property] = copied.properties;
  if (
    !isNodeOfType(outerSpread, "SpreadElement") ||
    scopes.symbolFor(stripParenExpression(outerSpread.argument)) !== previous ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    getStaticPropertyKeyName(property) !== fieldName
  )
    return false;
  const dictionary = stripParenExpression(property.value);
  if (!isNodeOfType(dictionary, "ObjectExpression") || dictionary.properties.length !== 1)
    return false;
  const [innerSpread] = dictionary.properties;
  if (!isNodeOfType(innerSpread, "SpreadElement")) return false;
  const inner = stripParenExpression(innerSpread.argument);
  if (
    !isNodeOfType(inner, "MemberExpression") ||
    scopes.symbolFor(stripParenExpression(inner.object)) !== previous ||
    getStaticPropertyName(inner) !== fieldName
  )
    return false;

  const statements = guard.parent.body;
  const successor = statements[statements.findIndex((statement) => statement === guard) + 1];
  const branches = new Set(
    isNodeOfType(successor, "IfStatement")
      ? [
          getSingleStatement(successor.consequent),
          successor.alternate && getSingleStatement(successor.alternate),
        ]
      : [successor],
  );
  if (!branches.has(target.parent?.parent)) return false;
  // Keep the draft local until the updater returns it. Later iterations may
  // reuse the copy, but they cannot replace its dictionary or share it early.
  for (const reference of draft.references) {
    const identifier = reference.identifier;
    if (identifier === writes[0].identifier || identifier === draftCheck) continue;
    if (findEnclosingFunction(identifier) !== updater) return false;
    const root = findTransparentExpressionRoot(identifier);
    if (isNodeOfType(root.parent, "ReturnStatement") && root.parent.argument === root) continue;
    const write = getOwnEntryWrite(identifier, fieldName);
    if (!write || !branches.has(write.parent)) return false;
  }
  let hasDynamicLookup = false;
  walkAst(updater, (node) => {
    if (hasDynamicLookup) return false;
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      hasDynamicLookup = isNodeOfType(callee, "Identifier") && callee.name === "eval";
    }
  });
  return !hasDynamicLookup;
};
