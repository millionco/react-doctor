import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasVisibleBindingNamed } from "../../../utils/has-visible-binding-named.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  STRUCTURED_CLONE_GLOBAL_EXPOSURE_NAMES,
  STRUCTURED_CLONE_GLOBAL_OBJECT_NAMES,
  STRUCTURED_CLONE_PROVIDER_NAMES,
} from "./constants.js";

const selfDefinitionClosureCache = new WeakMap<EsTreeNodeOfType<"MemberExpression">, boolean>();

export const isStructuredCloneSelfDefinition = (
  expression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const implementation = findEnclosingFunction(expression);
  if (
    !isFunctionLike(implementation) ||
    implementation.async ||
    implementation.generator ||
    hasVisibleBindingNamed(expression, "structuredClone", scopes)
  )
    return false;
  const returnedExpression = findTransparentExpressionRoot(expression);
  const returnStatement = returnedExpression.parent;
  if (
    implementation.body !== returnedExpression &&
    (!isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== returnedExpression ||
      findEnclosingFunction(returnStatement) !== implementation)
  )
    return false;
  const parseMember = expression.callee;
  const stringify = expression.arguments[0];
  if (
    !isNodeOfType(parseMember, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(parseMember.object), "Identifier") ||
    !scopes.isGlobalReference(stripParenExpression(parseMember.object)) ||
    !isNodeOfType(stringify, "CallExpression") ||
    !isNodeOfType(stringify.callee, "MemberExpression") ||
    !scopes.isGlobalReference(stripParenExpression(stringify.callee.object))
  )
    return false;
  let installedValue = findTransparentExpressionRoot(implementation);
  const wrapper = installedValue.parent;
  if (isNodeOfType(wrapper, "CallExpression")) {
    const method = stripParenExpression(wrapper.callee);
    if (
      wrapper.optional ||
      wrapper.arguments.length !== 1 ||
      wrapper.arguments[0] !== installedValue ||
      !isNodeOfType(method, "MemberExpression") ||
      method.computed ||
      method.optional ||
      !isNodeOfType(method.object, "Identifier") ||
      method.object.name !== "jest" ||
      !scopes.isGlobalReference(method.object) ||
      !isNodeOfType(method.property, "Identifier") ||
      method.property.name !== "fn"
    )
      return false;
    installedValue = findTransparentExpressionRoot(wrapper);
  }
  const assignment = installedValue.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== installedValue
  )
    return false;
  const target = stripParenExpression(assignment.left);
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    target.optional ||
    !isNodeOfType(target.object, "Identifier") ||
    !STRUCTURED_CLONE_GLOBAL_OBJECT_NAMES.has(target.object.name) ||
    !scopes.isGlobalReference(target.object) ||
    !isNodeOfType(target.property, "Identifier") ||
    target.property.name !== "structuredClone"
  )
    return false;
  const cachedClosure = selfDefinitionClosureCache.get(target);
  if (cachedClosure !== undefined) return cachedClosure;
  const program = findProgramRoot(assignment);
  if (!program) return false;
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
      (isNodeOfType(node, "TSModuleDeclaration") && !node.declare) ||
      (isNodeOfType(node, "TSImportEqualsDeclaration") && node.importKind !== "type") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSParameterProperty")
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))) &&
      getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true }) ===
        "constructor"
    ) {
      isClosed = false;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      !STRUCTURED_CLONE_PROVIDER_NAMES.has(node.name) ||
      !scopes.referenceFor(node)
    )
      return;
    const symbol = scopes.symbolFor(node);
    if (symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol)) {
      isClosed = false;
      return false;
    }
    if (!scopes.isGlobalReference(node)) return;
    const reference = findTransparentExpressionRoot(node);
    const consumer = reference.parent;
    if (STRUCTURED_CLONE_GLOBAL_OBJECT_NAMES.has(node.name)) {
      if (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "typeof") return;
      if (
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== reference ||
        consumer.computed ||
        consumer.optional ||
        !isNodeOfType(consumer.property, "Identifier")
      ) {
        isClosed = false;
        return false;
      }
      if (consumer === target) return;
      if (STRUCTURED_CLONE_GLOBAL_EXPOSURE_NAMES.has(consumer.property.name)) isClosed = false;
      return;
    }
    if (node.name !== "jest" && node.name !== "JSON") {
      isClosed = false;
      return false;
    }
    if (
      !isNodeOfType(consumer, "MemberExpression") ||
      consumer.object !== reference ||
      consumer.computed ||
      consumer.optional ||
      !isNodeOfType(consumer.property, "Identifier") ||
      isWithinAssignmentTarget(consumer)
    ) {
      isClosed = false;
      return false;
    }
    const callReference = findTransparentExpressionRoot(consumer);
    const call = callReference.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== callReference ||
      call.optional ||
      (node.name === "jest"
        ? consumer.property.name !== "fn"
        : consumer.property.name !== "parse" && consumer.property.name !== "stringify")
    )
      isClosed = false;
  });
  selfDefinitionClosureCache.set(target, isClosed);
  return isClosed;
};
