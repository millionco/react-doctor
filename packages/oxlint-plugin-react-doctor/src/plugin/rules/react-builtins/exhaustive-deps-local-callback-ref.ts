import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getResolvedStaticPropertyName } from "../../utils/get-resolved-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { walkAst } from "../../utils/walk-ast.js";
import { unwrapExpression } from "./exhaustive-deps-low-level.js";

const DYNAMIC_RUNTIME_NAMES = new Set(["eval", "Function", "require", "React"]);
const DYNAMIC_RUNTIME_PROPERTIES = new Set([
  "eval",
  "Function",
  "require",
  "createRequire",
  "constructor",
  "React",
]);
const closedRuntimeByScope = new WeakMap<ScopeAnalysis, boolean>();

// Writing a property on the node held by .current does not replace the
// callback binding or the .current field itself.
const isWriteThroughCurrent = (identifier: EsTreeNode): boolean => {
  const current = identifier.parent;
  const member = current?.parent;
  return (
    isNodeOfType(current, "MemberExpression") &&
    current.object === identifier &&
    !current.computed &&
    getStaticPropertyName(current) === "current" &&
    isNodeOfType(member, "MemberExpression") &&
    member.object === current
  );
};

const isReadOnly = (symbol: SymbolDescriptor, allowCurrentMemberWrites = false): boolean =>
  symbol.references.every(
    (reference) =>
      reference.flag === "read" &&
      (!isWithinAssignmentTarget(reference.identifier) ||
        (allowCurrentMemberWrites && isWriteThroughCurrent(reference.identifier))),
  );

const isNamedUseCallback = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(call.callee);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  return Boolean(
    symbol?.kind === "import" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "react" &&
    getImportedName(specifier) === "useCallback" &&
    isReadOnly(symbol),
  );
};

// This proof assumes stock React resolution. Decline visible runtime namespace
// access or loaders in the source file, including side-effect-only imports.
const hasClosedReactImports = (scopes: ScopeAnalysis): boolean => {
  const cached = closedRuntimeByScope.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (isTypeOnlyImport(node)) return;
      closed =
        node.source.value === "react" &&
        node.specifiers.length > 0 &&
        node.specifiers.every(
          (specifier) =>
            isNodeOfType(specifier, "ImportSpecifier") &&
            (specifier.importKind === "type" || getImportedName(specifier) !== "default"),
        );
    } else if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "ExportNamedDeclaration") && node.source && node.exportKind !== "type") ||
      (isNodeOfType(node, "ExportAllDeclaration") && node.exportKind !== "type") ||
      (isNodeOfType(node, "Identifier") &&
        DYNAMIC_RUNTIME_NAMES.has(node.name) &&
        scopes.isGlobalReference(node)) ||
      (isNodeOfType(node, "RestElement") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      closed = false;
    } else if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, scopes, {
        stringifyNonStringLiterals: true,
      });
      closed = property !== null ? !DYNAMIC_RUNTIME_PROPERTIES.has(property) : !node.computed;
    }
    if (!closed) return false;
  });
  closedRuntimeByScope.set(scopes, closed);
  return closed;
};

const hasIdentifierBinding = (
  node: EsTreeNode | null | undefined,
  binding: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === binding;

const getDirectLocalConstCall = (
  node: EsTreeNode,
  owner: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
  allowCurrentMemberWrites = false,
): SymbolDescriptor | null => {
  const declaration = node.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.parent !== owner
  )
    return null;
  const symbol = scopes.symbolFor(declaration.id);
  return symbol &&
    getDirectConstInitializer(symbol) === node &&
    isReadOnly(symbol, allowCurrentMemberWrites)
    ? symbol
    : null;
};

const isClosedCallbackRefWrapper = (wrapper: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const declaration = wrapper.declarationNode;
  if (
    !isNodeOfType(declaration, "FunctionDeclaration") ||
    !isNodeOfType(declaration.parent, "Program") ||
    declaration.id !== wrapper.bindingIdentifier ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 2 ||
    !isNodeOfType(declaration.params[0], "Identifier") ||
    !isNodeOfType(declaration.params[1], "Identifier") ||
    !isNodeOfType(declaration.body, "BlockStatement") ||
    declaration.body.body.length !== 2 ||
    !isReadOnly(wrapper) ||
    !wrapper.references.every(
      ({ identifier }) =>
        isNodeOfType(identifier.parent, "CallExpression") &&
        identifier.parent.callee === identifier &&
        !identifier.parent.optional,
    )
  )
    return false;

  const callback = scopes.symbolFor(declaration.params[0]);
  const deps = scopes.symbolFor(declaration.params[1]);
  const [initialization, returning] = declaration.body.body;
  if (
    !callback ||
    !deps ||
    !isNodeOfType(initialization, "VariableDeclaration") ||
    initialization.kind !== "const" ||
    initialization.declarations.length !== 1 ||
    !isNodeOfType(returning, "ReturnStatement")
  )
    return false;
  const [declarator] = initialization.declarations;
  if (!declarator || !isNodeOfType(declarator.id, "Identifier") || !declarator.init) return false;
  const result = scopes.symbolFor(declarator.id);
  if (!result || !hasIdentifierBinding(returning.argument, result, scopes)) return false;
  const memo = unwrapExpression(declarator.init);
  if (
    !isNodeOfType(memo, "CallExpression") ||
    !isNamedUseCallback(memo, scopes) ||
    memo.arguments.length !== 2 ||
    !hasIdentifierBinding(memo.arguments[1], deps, scopes)
  )
    return false;
  const [refCallback] = memo.arguments;
  if (
    !isNodeOfType(refCallback, "ArrowFunctionExpression") ||
    refCallback.async ||
    refCallback.params.length !== 1 ||
    !isNodeOfType(refCallback.params[0], "Identifier") ||
    !isNodeOfType(refCallback.body, "BlockStatement") ||
    refCallback.body.body.length !== 2
  )
    return false;
  const parameter = scopes.symbolFor(refCallback.params[0]);
  if (!parameter) return false;

  const [writeStatement, forwarding] = refCallback.body.body;
  const write = isNodeOfType(writeStatement, "ExpressionStatement")
    ? writeStatement.expression
    : null;
  const follow = isNodeOfType(forwarding, "ReturnStatement")
    ? forwarding.argument
    : isNodeOfType(forwarding, "ExpressionStatement")
      ? forwarding.expression
      : null;
  return (
    isNodeOfType(write, "AssignmentExpression") &&
    write.operator === "=" &&
    isNodeOfType(write.left, "MemberExpression") &&
    !write.left.computed &&
    getStaticPropertyName(write.left) === "current" &&
    hasIdentifierBinding(write.left.object, result, scopes) &&
    hasIdentifierBinding(write.right, parameter, scopes) &&
    isNodeOfType(follow, "CallExpression") &&
    !follow.optional &&
    follow.arguments.length === 1 &&
    hasIdentifierBinding(follow.callee, callback, scopes) &&
    hasIdentifierBinding(follow.arguments[0], parameter, scopes)
  );
};

// A delayed useCallback may capture a callback ref initialized later in the
// same render. The forwarded empty deps fix the ref function's identity,
// and the consumer reads its current value only when that consumer is called.
export const isLocalCallbackRefCurrentCapture = (
  reference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  consumer: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const member = reference.identifier.parent;
  const owner = findEnclosingFunction(consumer);
  if (
    reference.flag !== "read" ||
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== reference.identifier ||
    member.computed ||
    getStaticPropertyName(member) !== "current" ||
    isWithinAssignmentTarget(member) ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback !== consumer.arguments[0] ||
    findEnclosingFunction(reference.identifier) !== callback ||
    !owner ||
    !isFunctionLike(owner) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !isNamedUseCallback(consumer, scopes) ||
    !getDirectLocalConstCall(consumer, owner.body, scopes)
  )
    return false;
  const producer = getDirectConstInitializer(symbol);
  if (
    !isNodeOfType(producer, "CallExpression") ||
    producer.optional ||
    !isNodeOfType(producer.callee, "Identifier") ||
    producer.arguments.length !== 2 ||
    !isNodeOfType(producer.arguments[0], "ArrowFunctionExpression") ||
    !isNodeOfType(producer.arguments[1], "ArrayExpression") ||
    producer.arguments[1].elements.length !== 0 ||
    getDirectLocalConstCall(producer, owner.body, scopes, true) !== symbol
  )
    return false;
  const wrapper = scopes.symbolFor(producer.callee);
  return Boolean(
    wrapper && isClosedCallbackRefWrapper(wrapper, scopes) && hasClosedReactImports(scopes),
  );
};
