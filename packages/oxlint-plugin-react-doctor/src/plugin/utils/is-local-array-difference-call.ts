import {
  ARRAY_DIFFERENCE_OPERAND_COUNT,
  ARRAY_DIFFERENCE_CALLBACK_COUNT,
} from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { resolveStaticLocalCallFunction } from "./get-order-independent-local-function.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasDynamicScopeAccess } from "./has-dynamic-scope-access.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const UNSUPPORTED_CAPABILITY_NAMES = new Set([
  "Array",
  "Reflect",
  "Proxy",
  "Function",
  "eval",
  "globalThis",
  "global",
  "window",
  "self",
  "require",
  "module",
  "exports",
  "process",
]);
const UNSUPPORTED_MEMBER_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "copyWithin",
  "fill",
]);
const UNSUPPORTED_RUNTIME_TYPES = new Set([
  "ImportExpression",
  "WithStatement",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);
const UNSUPPORTED_LOADER_SOURCES = new Set(["module", "node:module", "vm", "node:vm"]);

const isStaticMember = (node: EsTreeNode, name: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === name;

const isSameBinding = (node: EsTreeNode, binding: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const identifier = stripParenExpression(node);
  return (
    isNodeOfType(identifier, "Identifier") &&
    Boolean(scopes.symbolFor(identifier)) &&
    scopes.symbolFor(identifier) === scopes.symbolFor(binding)
  );
};

const getArrayParameter = (parameter: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(parameter, "Identifier")) return parameter;
  if (
    !isNodeOfType(parameter, "AssignmentPattern") ||
    !isNodeOfType(parameter.left, "Identifier") ||
    !isNodeOfType(parameter.right, "ArrayExpression") ||
    parameter.right.elements.length !== 0
  )
    return null;
  return parameter.left;
};

const hasVisibleArrayComparisonHazard = (
  program: EsTreeNode,
  indexedElement: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let hasHazard = false;
  walkAst(program, (node) => {
    if (hasHazard || isTypeScriptTypePosition(node)) return false;
    const dependencySource = getRuntimeStaticDependencySource(node);
    if (dependencySource && UNSUPPORTED_LOADER_SOURCES.has(dependencySource)) {
      hasHazard = true;
      return false;
    }
    if (UNSUPPORTED_RUNTIME_TYPES.has(node.type)) {
      hasHazard = true;
      return false;
    }
    if (
      isNodeOfType(node, "Property") ||
      isNodeOfType(node, "MethodDefinition") ||
      isNodeOfType(node, "PropertyDefinition")
    ) {
      if (
        ("kind" in node && node.kind === "get") ||
        node.computed ||
        getStaticPropertyKeyName(node) === "some"
      )
        hasHazard = true;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (
        (node.computed && node !== indexedElement) ||
        (name !== null && UNSUPPORTED_MEMBER_NAMES.has(name)) ||
        (name === "some" && isMemberMutationTarget(node)) ||
        (isMemberMutationTarget(node) &&
          (!isNodeOfType(node.object, "ThisExpression") || node.computed || name === "props"))
      )
        hasHazard = true;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      isNonReferenceIdentifier(node) ||
      !scopes.referenceFor(node)
    )
      return;
    if (UNSUPPORTED_CAPABILITY_NAMES.has(node.name)) hasHazard = true;
    if (node.name !== "Object") return;
    const member = node.parent;
    const call = member?.parent;
    if (
      !scopes.isGlobalReference(node) ||
      !member ||
      !isStaticMember(member, "is") ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.optional
    )
      hasHazard = true;
  });
  return hasHazard;
};

export const isLocalArrayDifferenceCall = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== ARRAY_DIFFERENCE_OPERAND_COUNT ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  const program = findProgramRoot(call);
  if (
    !symbol ||
    !program ||
    hasDynamicScopeAccess(scopes) ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return false;
  const declaration = symbol.declarationNode;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  const isDirectDeclaration =
    isNodeOfType(declaration, "FunctionDeclaration") ||
    (symbol.kind === "const" &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      declaration.id === symbol.bindingIdentifier &&
      initializer &&
      isFunctionLike(initializer));
  if (
    !isDirectDeclaration ||
    symbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      return (
        !isNodeOfType(referenceRoot.parent, "CallExpression") ||
        referenceRoot.parent.callee !== referenceRoot ||
        referenceRoot.parent.optional
      );
    })
  )
    return false;
  const declarationParent = isNodeOfType(declaration, "VariableDeclarator")
    ? declaration.parent?.parent
    : declaration.parent;
  if (declarationParent?.type !== "Program") return false;
  const helper = resolveStaticLocalCallFunction(call, scopes);
  if (
    !helper ||
    !isFunctionLike(helper) ||
    helper.async ||
    helper.generator ||
    helper.params.length !== ARRAY_DIFFERENCE_OPERAND_COUNT
  )
    return false;
  const [leftParameter, rightParameter] = helper.params.map(getArrayParameter);
  if (
    !leftParameter ||
    !rightParameter ||
    scopes.symbolFor(leftParameter) === scopes.symbolFor(rightParameter)
  )
    return false;
  const returned = getSingleReturnExpression(helper);
  const difference = returned ? stripParenExpression(returned) : null;
  if (!isNodeOfType(difference, "LogicalExpression") || difference.operator !== "||") return false;
  const lengthComparison = stripParenExpression(difference.left);
  const someCall = stripParenExpression(difference.right);
  if (
    !isNodeOfType(lengthComparison, "BinaryExpression") ||
    lengthComparison.operator !== "!==" ||
    !isNodeOfType(lengthComparison.left, "MemberExpression") ||
    !isNodeOfType(lengthComparison.right, "MemberExpression") ||
    !isStaticMember(lengthComparison.left, "length") ||
    !isStaticMember(lengthComparison.right, "length") ||
    !isSameBinding(lengthComparison.left.object, leftParameter, scopes) ||
    !isSameBinding(lengthComparison.right.object, rightParameter, scopes) ||
    !isNodeOfType(someCall, "CallExpression") ||
    someCall.optional ||
    someCall.arguments.length !== ARRAY_DIFFERENCE_CALLBACK_COUNT ||
    !isNodeOfType(someCall.callee, "MemberExpression") ||
    !isStaticMember(someCall.callee, "some") ||
    !isSameBinding(someCall.callee.object, leftParameter, scopes)
  )
    return false;
  const [callback] = someCall.arguments;
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== ARRAY_DIFFERENCE_OPERAND_COUNT ||
    !callback.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  )
    return false;
  const [itemParameter, indexParameter] = callback.params;
  const callbackReturn = getSingleReturnExpression(callback);
  const negation = callbackReturn ? stripParenExpression(callbackReturn) : null;
  if (!isNodeOfType(negation, "UnaryExpression") || negation.operator !== "!") return false;
  const sameValueCall = stripParenExpression(negation.argument);
  if (
    !isNodeOfType(sameValueCall, "CallExpression") ||
    sameValueCall.optional ||
    sameValueCall.arguments.length !== ARRAY_DIFFERENCE_OPERAND_COUNT ||
    !isNodeOfType(sameValueCall.callee, "MemberExpression") ||
    !isStaticMember(sameValueCall.callee, "is") ||
    !isNodeOfType(sameValueCall.callee.object, "Identifier") ||
    sameValueCall.callee.object.name !== "Object" ||
    !scopes.isGlobalReference(sameValueCall.callee.object)
  )
    return false;
  const [item, indexedElement] = sameValueCall.arguments;
  if (
    !isSameBinding(item, itemParameter, scopes) ||
    !isNodeOfType(indexedElement, "MemberExpression") ||
    !indexedElement.computed ||
    indexedElement.optional ||
    !isSameBinding(indexedElement.object, rightParameter, scopes) ||
    !isSameBinding(indexedElement.property, indexParameter, scopes)
  )
    return false;
  return !hasVisibleArrayComparisonHazard(program, indexedElement, scopes);
};
