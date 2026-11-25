import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// A declaration-shape proof only. Stock Array.prototype.forEach and the
// imported/exported binding's selected runtime identity belong to the caller.
export const isDeferredDisposalFactory = (
  module: SourceProjectModule,
  exportedNode: EsTreeNode,
): boolean => {
  const fn = stripParenExpression(exportedNode);
  if (
    (!isNodeOfType(fn, "FunctionDeclaration") &&
      !isNodeOfType(fn, "FunctionExpression") &&
      !isNodeOfType(fn, "ArrowFunctionExpression")) ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 1 ||
    !isNodeOfType(fn.body, "BlockStatement") ||
    fn.body.body.length !== 1
  )
    return false;
  // Reject a reassigned function declaration or non-const factory binding.
  const owner = isNodeOfType(fn, "FunctionDeclaration")
    ? fn.id
    : isNodeOfType(fn.parent, "VariableDeclarator")
      ? fn.parent.id
      : null;
  if (!isNodeOfType(owner, "Identifier")) return false;
  let bindingWrite = false;
  walkAst(module.programNode, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === owner.name &&
      isWithinAssignmentTarget(node)
    )
      bindingWrite = true;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "eval"
    )
      bindingWrite = true;
  });
  if (bindingWrite) return false;
  const binding = module.scopes.symbolFor(owner);
  if (!binding || binding.references.some((reference) => reference.flag !== "read")) return false;
  if (
    !isNodeOfType(fn, "FunctionDeclaration") &&
    (!isNodeOfType(fn.parent?.parent, "VariableDeclaration") || fn.parent.parent.kind !== "const")
  )
    return false;
  const parameter = fn.params[0];
  if (!isNodeOfType(parameter, "RestElement") || !isNodeOfType(parameter.argument, "Identifier"))
    return false;
  const returned = fn.body.body[0];
  if (!isNodeOfType(returned, "ReturnStatement") || !returned.argument) return false;
  const dispose = stripParenExpression(returned.argument);
  if (
    !isNodeOfType(dispose, "ArrowFunctionExpression") ||
    dispose.async ||
    dispose.generator ||
    dispose.params.length !== 0 ||
    !isNodeOfType(dispose.body, "BlockStatement") ||
    dispose.body.body.length !== 1
  )
    return false;
  const statement = dispose.body.body[0];
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const each = stripParenExpression(statement.expression);
  if (
    !isNodeOfType(each, "CallExpression") ||
    each.optional ||
    each.arguments.length !== 1 ||
    !isNodeOfType(each.callee, "MemberExpression") ||
    each.callee.optional ||
    each.callee.computed ||
    !isNodeOfType(each.callee.property, "Identifier") ||
    each.callee.property.name !== "forEach" ||
    !isNodeOfType(each.callee.object, "Identifier")
  )
    return false;
  const cleaners = module.scopes.symbolFor(parameter.argument);
  if (
    !cleaners ||
    module.scopes.symbolFor(each.callee.object) !== cleaners ||
    cleaners.references.length !== 1 ||
    cleaners.references[0].identifier !== each.callee.object ||
    cleaners.references[0].flag !== "read"
  )
    return false;
  const visitor = each.arguments[0];
  if (
    !isNodeOfType(visitor, "ArrowFunctionExpression") ||
    visitor.async ||
    visitor.generator ||
    visitor.params.length !== 1 ||
    !isNodeOfType(visitor.params[0], "Identifier") ||
    !isNodeOfType(visitor.body, "BlockStatement") ||
    visitor.body.body.length !== 1
  )
    return false;
  const action = visitor.body.body[0];
  if (!isNodeOfType(action, "ExpressionStatement")) return false;
  const invoke = stripParenExpression(action.expression);
  if (
    !isNodeOfType(invoke, "CallExpression") ||
    invoke.optional ||
    invoke.arguments.length !== 0 ||
    !isNodeOfType(invoke.callee, "Identifier")
  )
    return false;
  const cleaner = module.scopes.symbolFor(visitor.params[0]);
  return Boolean(
    cleaner &&
    module.scopes.symbolFor(invoke.callee) === cleaner &&
    cleaner.references.length === 1 &&
    cleaner.references[0].identifier === invoke.callee &&
    cleaner.references[0].flag === "read",
  );
};
