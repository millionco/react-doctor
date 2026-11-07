import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isOwnObjectEnumeration } from "./is-own-object-enumeration.js";
import { isVirtualProviderDataIndex } from "./is-virtual-provider-data-index.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface VirtualProviderGuard {
  readonly hasOpaqueAccess: (node: EsTreeNode) => boolean;
  readonly isLocalCallable: (binding: SymbolDescriptor | null) => boolean;
}

const INTRINSIC_ESCAPE_PROPERTIES = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "caller",
  "callee",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
const OWN_OBJECT_OPERATIONS = new Set([
  "assign",
  "keys",
  "getOwnPropertySymbols",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
]);
const PROVIDER_MEMBER_CALLS = new Set([
  "createContext",
  "createElement",
  "filter",
  "forEach",
  "indexOf",
  "map",
]);

const isDirectCall = (node: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(node);
  return (
    isNodeOfType(expression.parent, "CallExpression") &&
    !expression.parent.optional &&
    expression.parent.callee === expression
  );
};

const isProviderGlobalRead = (node: EsTreeNodeOfType<"Identifier">): boolean => {
  if (isWithinAssignmentTarget(node)) return false;
  const parent = node.parent;
  switch (node.name) {
    case "undefined":
    case "arguments":
      return true;
    case "TypeError":
      return isNodeOfType(parent, "NewExpression") && parent.callee === node;
    case "Object": {
      if (isDirectCall(node)) return true;
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== node) return false;
      const key = getStaticPropertyKeyName(parent);
      return Boolean(key && OWN_OBJECT_OPERATIONS.has(key));
    }
    case "String":
    case "Number":
      return (
        isDirectCall(node) ||
        (isNodeOfType(parent, "ConditionalExpression") &&
          (parent.consequent === node || parent.alternate === node) &&
          isDirectCall(parent))
      );
    case "Symbol":
      return (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === node &&
        getStaticPropertyKeyName(parent) === "toPrimitive"
      );
    default:
      return false;
  }
};

const isObjectAssign = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  getStaticPropertyKeyName(node) === "assign" &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === "Object" &&
  scopes.isGlobalReference(node.object);

const isNativeAssignBind = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "CallExpression") &&
  node.arguments.length === 0 &&
  isNodeOfType(node.callee, "MemberExpression") &&
  getStaticPropertyKeyName(node.callee) === "bind" &&
  isObjectAssign(node.callee.object, scopes);

const isProviderLocalCallable = (
  binding: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !binding ||
    !isFunctionLike(binding.initializer) ||
    binding.initializer.async ||
    binding.initializer.generator
  )
    return false;
  const declared = binding.initializer;
  const bodyBinding =
    isNodeOfType(declared, "FunctionDeclaration") && declared.id
      ? scopes.symbolFor(declared.id)
      : null;
  const references =
    bodyBinding && bodyBinding !== binding
      ? [...binding.references, ...bodyBinding.references]
      : binding.references;
  const writes = references.filter(({ flag }) => flag !== "read");
  if (writes.length === 0) return true;
  const write = writes[0]?.identifier;
  const assignment = write?.parent;
  return (
    writes.length === 1 &&
    isNodeOfType(declared, "FunctionDeclaration") &&
    isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.operator === "=" &&
    assignment.left === write &&
    findEnclosingFunction(assignment) === declared &&
    isNodeOfType(assignment.right, "ConditionalExpression") &&
    isObjectAssign(assignment.right.test, scopes) &&
    isNativeAssignBind(assignment.right.consequent, scopes) &&
    isNodeOfType(assignment.right.alternate, "FunctionExpression") &&
    !assignment.right.alternate.async &&
    !assignment.right.alternate.generator
  );
};

const isProviderFunctionMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  receiver: EsTreeNode,
  method: "apply" | "bind" | "call",
  scopes: ScopeAnalysis,
): boolean => {
  if (method === "bind") return call.arguments.length === 0 && isObjectAssign(receiver, scopes);
  if (call.arguments.length !== 2) return false;
  if (isNodeOfType(receiver, "MemberExpression")) {
    const member = getStaticPropertyKeyName(receiver);
    if (method === "apply" && member === "push") {
      const object = receiver.object;
      return (
        isNodeOfType(object, "Identifier") &&
        isOwnObjectEnumeration(scopes.symbolFor(object)?.initializer, scopes, "keys") &&
        scopes.symbolFor(call.arguments[0]) === scopes.symbolFor(object)
      );
    }
    if (method !== "call" || (member !== "hasOwnProperty" && member !== "propertyIsEnumerable"))
      return false;
    const object = stripParenExpression(receiver.object);
    return isNodeOfType(object, "ObjectExpression") && object.properties.length === 0;
  }
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const binding = scopes.symbolFor(receiver);
  if (method === "apply") return isProviderLocalCallable(binding, scopes);
  const source = binding?.initializer;
  return Boolean(
    binding &&
    binding.references.every(({ flag }) => flag === "read") &&
    isNodeOfType(source, "MemberExpression") &&
    source.computed &&
    isNodeOfType(source.property, "MemberExpression") &&
    isNodeOfType(source.property.object, "Identifier") &&
    source.property.object.name === "Symbol" &&
    scopes.isGlobalReference(source.property.object) &&
    getStaticPropertyKeyName(source.property) === "toPrimitive",
  );
};

const isProviderCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const name = getStaticPropertyKeyName(callee);
    if (name === "apply" || name === "bind" || name === "call")
      return isProviderFunctionMethodCall(node, callee.object, name, scopes);
    return Boolean(name && (PROVIDER_MEMBER_CALLS.has(name) || OWN_OBJECT_OPERATIONS.has(name)));
  }
  if (isNodeOfType(callee, "Identifier")) {
    if (scopes.isGlobalReference(callee)) return isProviderGlobalRead(callee);
    return isProviderLocalCallable(scopes.symbolFor(callee), scopes);
  }
  if (!isNodeOfType(callee, "ConditionalExpression")) return false;
  return [callee.consequent, callee.alternate].every(
    (branch) =>
      isNodeOfType(branch, "Identifier") &&
      (branch.name === "Number" || branch.name === "String") &&
      scopes.isGlobalReference(branch),
  );
};

const hasOpaqueProviderAccess = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  manifestName: string,
): boolean => {
  if (
    isNodeOfType(node, "ImportExpression") ||
    isNodeOfType(node, "MetaProperty") ||
    isNodeOfType(node, "ThisExpression") ||
    isNodeOfType(node, "TaggedTemplateExpression") ||
    isNodeOfType(node, "SpreadElement") ||
    isNodeOfType(node, "ClassExpression") ||
    isNodeOfType(node, "ClassDeclaration") ||
    isNodeOfType(node, "ForOfStatement") ||
    (isNodeOfType(node, "NewExpression") &&
      (!isNodeOfType(node.callee, "Identifier") ||
        node.callee.name !== "TypeError" ||
        !scopes.isGlobalReference(node.callee))) ||
    (isNodeOfType(node, "CallExpression") && !isProviderCall(node, scopes))
  )
    return true;
  if (
    isNodeOfType(node, "MemberExpression") ||
    (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
  ) {
    const key = getResolvedStaticPropertyName(node, scopes, {
      allowConstNumericLiteral: true,
      allowConstTemplateLiteral: true,
      stringifyNonStringLiterals: true,
    });
    if (key !== null && (key === manifestName || INTRINSIC_ESCAPE_PROPERTIES.has(key))) return true;
    if (
      node.computed &&
      key === null &&
      (!isNodeOfType(node, "MemberExpression") || !isVirtualProviderDataIndex(node, scopes))
    )
      return true;
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const reference = scopes.referenceFor(node);
  if (node.name === manifestName && reference) return true;
  if (scopes.isGlobalReference(node)) return !isProviderGlobalRead(node);
  const binding = reference?.resolvedSymbol;
  if (!binding || !isNodeOfType(binding.declarationNode, "ImportDefaultSpecifier")) return false;
  if (getImportDeclarationForSymbol(binding)?.source.value !== "react") return false;
  const member = node.parent;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== node) return true;
  const operation = getStaticPropertyKeyName(member);
  return !(
    ((operation === "createElement" || operation === "createContext") && isDirectCall(member)) ||
    (operation === "createContext" &&
      isNodeOfType(member.parent, "LogicalExpression") &&
      member.parent.operator === "&&" &&
      member.parent.left === member)
  );
};

export const createVirtualProviderGuard = (
  scopes: ScopeAnalysis,
  manifestName: string,
): VirtualProviderGuard => ({
  hasOpaqueAccess: (node) => hasOpaqueProviderAccess(node, scopes, manifestName),
  isLocalCallable: (binding) => isProviderLocalCallable(binding, scopes),
});
