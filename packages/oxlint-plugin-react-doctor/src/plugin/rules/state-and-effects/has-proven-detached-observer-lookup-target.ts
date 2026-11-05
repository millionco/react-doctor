import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { someAst } from "../../utils/some-ast.js";

interface GuardedLookupIteration {
  readonly statement: EsTreeNodeOfType<"ExpressionStatement">;
  readonly receiver: EsTreeNodeOfType<"Identifier">;
  readonly collection: SymbolDescriptor;
  readonly target: SymbolDescriptor;
  readonly documentReceiver: EsTreeNodeOfType<"Identifier">;
  readonly guardStatements: ReadonlyArray<EsTreeNode>;
}

interface DetachedObserverLookupInput {
  readonly observation: EsTreeNodeOfType<"CallExpression">;
  readonly release: EsTreeNodeOfType<"CallExpression">;
  readonly construction: EsTreeNodeOfType<"NewExpression">;
  readonly cleanupFunction: EsTreeNode;
  readonly context: RuleContext;
}

interface DetachedProviderRoles {
  readonly documentReceivers: ReadonlySet<EsTreeNode>;
  readonly observerConstructor: EsTreeNode | null;
}

interface DetachedReplacementRoles {
  readonly documentReceiver: EsTreeNodeOfType<"Identifier">;
  readonly existenceCheck: EsTreeNode;
  readonly replaceReceiver: EsTreeNodeOfType<"Identifier">;
}

const detachedProviderRolesByScope = new WeakMap<ScopeAnalysis, DetachedProviderRoles | null>();

const NATIVE_CAPABILITY_NAMES = new Set([
  "Array",
  "Function",
  "Object",
  "Reflect",
  "createRequire",
  "eval",
  "global",
  "globalThis",
  "module",
  "top",
  "parent",
  "frames",
  "process",
  "require",
  "self",
  "window",
]);
const REFLECTIVE_MEMBER_NAMES = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "ownerDocument",
  "defaultView",
  "parentWindow",
  "contentWindow",
]);

const PROTECTED_NATIVE_METHOD_NAMES = new Set([
  "getElementById",
  "contains",
  "createElement",
  "replaceWith",
  "observe",
  "unobserve",
  "forEach",
]);
const NATIVE_ELEMENT_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

const isUncertainProtectedMember = (member: EsTreeNodeOfType<"MemberExpression">): boolean => {
  const name = getStaticPropertyName(member);
  if (member.computed || REFLECTIVE_MEMBER_NAMES.has(name ?? "")) return true;
  if (!name || !PROTECTED_NATIVE_METHOD_NAMES.has(name)) return false;
  return (
    isWithinAssignmentTarget(member) ||
    !isNodeOfType(member.parent, "CallExpression") ||
    member.parent.callee !== member
  );
};

const isUncertainCapabilityKey = (property: EsTreeNodeOfType<"Property">): boolean => {
  if (property.computed) return true;
  const name = getStaticPropertyKeyName(property);
  return Boolean(
    name &&
    (REFLECTIVE_MEMBER_NAMES.has(name) ||
      PROTECTED_NATIVE_METHOD_NAMES.has(name) ||
      NATIVE_CAPABILITY_NAMES.has(name) ||
      name === "document" ||
      name === "ResizeObserver" ||
      name === "IntersectionObserver"),
  );
};

const readDetachedProviderRoles = (
  scopes: ScopeAnalysis,
  documentRoleCount: number,
): DetachedProviderRoles | null => {
  const cached = detachedProviderRolesByScope.get(scopes);
  if (cached !== undefined) return cached;
  const documentReceivers = new Set<EsTreeNode>();
  let observerConstructor: EsTreeNode | null = null;
  const uncertain = someAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "Identifier")) {
      if (node.name === "document") {
        documentReceivers.add(node);
        return documentReceivers.size > documentRoleCount;
      }
      if (node.name === "ResizeObserver" || node.name === "IntersectionObserver") {
        if (observerConstructor && observerConstructor !== node) return true;
        observerConstructor = node;
        return false;
      }
      return NATIVE_CAPABILITY_NAMES.has(node.name);
    }
    return (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "MemberExpression") && isUncertainProtectedMember(node)) ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        isUncertainCapabilityKey(node))
    );
  });
  const roles = uncertain ? null : { documentReceivers, observerConstructor };
  detachedProviderRolesByScope.set(scopes, roles);
  return roles;
};

const getDirectMemberReceiver = (call: EsTreeNode | null | undefined, name: string) =>
  isNodeOfType(call, "CallExpression") &&
  !call.optional &&
  isNodeOfType(call.callee, "MemberExpression") &&
  !call.callee.optional &&
  !call.callee.computed &&
  getStaticPropertyName(call.callee) === name &&
  isNodeOfType(call.callee.object, "Identifier")
    ? call.callee.object
    : null;

const isNativeDocumentCall = (
  call: EsTreeNode | null | undefined,
  name: string,
  context: RuleContext,
): call is EsTreeNodeOfType<"CallExpression"> => {
  const receiver = getDirectMemberReceiver(call, name);
  return Boolean(
    receiver?.name === "document" &&
    isProvenUnmodifiedGlobalNamespaceReference(
      receiver,
      "document",
      context.scopes,
      undefined,
      true,
    ),
  );
};

const readGuardedLookupIteration = (
  observerCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): GuardedLookupIteration | null => {
  const { scopes } = context;
  const callback = findEnclosingFunction(observerCall);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return null;
  }
  const [declaration, guard, other] = callback.body.body;
  if (
    other ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "Identifier")
  ) {
    return null;
  }
  const parameter = scopes.symbolFor(callback.params[0]);
  const targetDeclaration = declaration.declarations[0];
  const lookup = targetDeclaration.init;
  const documentReceiver = getDirectMemberReceiver(lookup, "getElementById");
  if (
    !parameter ||
    !documentReceiver ||
    !isNodeOfType(targetDeclaration.id, "Identifier") ||
    !isNativeDocumentCall(lookup, "getElementById", context) ||
    lookup.arguments.length !== 1 ||
    !isNodeOfType(lookup.arguments[0], "Identifier") ||
    scopes.symbolFor(lookup.arguments[0]) !== parameter ||
    observerCall.arguments.length !== 1 ||
    !isNodeOfType(observerCall.arguments[0], "Identifier")
  ) {
    return null;
  }
  const target = scopes.symbolFor(targetDeclaration.id);
  if (
    !target ||
    scopes.symbolFor(guard.test) !== target ||
    scopes.symbolFor(observerCall.arguments[0]) !== target
  ) {
    return null;
  }
  const iterator = callback.parent;
  const receiver = getDirectMemberReceiver(iterator, "forEach");
  const statement = iterator?.parent;
  if (
    !receiver ||
    !isNodeOfType(iterator, "CallExpression") ||
    iterator.arguments.length !== 1 ||
    iterator.arguments[0] !== callback ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== iterator
  ) {
    return null;
  }
  const collection = scopes.symbolFor(receiver);
  if (!collection) return null;
  const guardStatements = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body
    : [guard.consequent];
  const last = guardStatements.at(-1);
  return isNodeOfType(last, "ExpressionStatement") && last.expression === observerCall
    ? { statement, receiver, collection, target, documentReceiver, guardStatements }
    : null;
};

const isSingleDeclarationStatement = (
  statement: EsTreeNode | null | undefined,
  declaration: EsTreeNode,
): boolean =>
  isNodeOfType(statement, "VariableDeclaration") &&
  statement.declarations.length === 1 &&
  statement.declarations[0] === declaration;

const readExpressionStatement = (statement: EsTreeNode | undefined): EsTreeNode | null =>
  isNodeOfType(statement, "ExpressionStatement") ? statement.expression : null;

const readDetachedReplacementRoles = (
  body: ReadonlyArray<EsTreeNode>,
  observed: SymbolDescriptor,
  expectedId: string,
  context: RuleContext,
): DetachedReplacementRoles | null => {
  const { scopes } = context;
  const [initialGuard, declaration, setIdStatement, replaceStatement, other] = body;
  if (
    other ||
    !isNodeOfType(initialGuard, "IfStatement") ||
    initialGuard.alternate ||
    !isNodeOfType(initialGuard.consequent, "ReturnStatement") ||
    initialGuard.consequent.argument ||
    !isNodeOfType(initialGuard.test, "UnaryExpression") ||
    initialGuard.test.operator !== "!" ||
    scopes.symbolFor(initialGuard.test.argument) !== observed ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  ) {
    return null;
  }
  const fresh = declaration.declarations[0];
  const creation = fresh.init;
  const replacement = scopes.symbolFor(fresh.id);
  if (
    !isNodeOfType(fresh.id, "Identifier") ||
    !replacement ||
    !isNativeDocumentCall(creation, "createElement", context) ||
    creation.arguments.length !== 1 ||
    !isNodeOfType(creation.arguments[0], "Literal") ||
    typeof creation.arguments[0].value !== "string" ||
    !NATIVE_ELEMENT_NAME_PATTERN.test(creation.arguments[0].value)
  ) {
    return null;
  }
  const setId = readExpressionStatement(setIdStatement);
  const replace = readExpressionStatement(replaceStatement);
  const replaceReceiver = getDirectMemberReceiver(replace, "replaceWith");
  const documentReceiver = getDirectMemberReceiver(creation, "createElement");
  return documentReceiver &&
    isNodeOfType(setId, "AssignmentExpression") &&
    setId.operator === "=" &&
    isNodeOfType(setId.left, "MemberExpression") &&
    !setId.left.computed &&
    getStaticPropertyName(setId.left) === "id" &&
    scopes.symbolFor(setId.left.object) === replacement &&
    isNodeOfType(setId.right, "Literal") &&
    setId.right.value === expectedId &&
    replaceReceiver &&
    scopes.symbolFor(replaceReceiver) === observed &&
    isNodeOfType(replace, "CallExpression") &&
    replace.arguments.length === 1 &&
    scopes.symbolFor(replace.arguments[0]) === replacement
    ? { documentReceiver, existenceCheck: initialGuard.test.argument, replaceReceiver }
    : null;
};

export const hasProvenDetachedObserverLookupTarget = ({
  observation,
  release,
  construction,
  cleanupFunction,
  context,
}: DetachedObserverLookupInput): boolean => {
  const { scopes } = context;
  const observeReceiver = getDirectMemberReceiver(observation, "observe");
  const releaseReceiver = getDirectMemberReceiver(release, "unobserve");
  const observer = observeReceiver && scopes.symbolFor(observeReceiver);
  const [observerCallback, otherConstructorArgument] = construction.arguments;
  if (
    otherConstructorArgument ||
    !isNodeOfType(observerCallback, "ArrowFunctionExpression") ||
    observerCallback.async ||
    observerCallback.params.length ||
    !isNodeOfType(observerCallback.body, "BlockStatement") ||
    observerCallback.body.body.length ||
    !observeReceiver ||
    !releaseReceiver ||
    !observer ||
    scopes.symbolFor(releaseReceiver) !== observer ||
    getDirectConstInitializer(observer) !== construction ||
    observer.references.length !== 2 ||
    observer.references.some(
      ({ identifier, flag }) =>
        flag !== "read" || (identifier !== observeReceiver && identifier !== releaseReceiver),
    ) ||
    !isNodeOfType(construction.callee, "Identifier") ||
    (construction.callee.name !== "ResizeObserver" &&
      construction.callee.name !== "IntersectionObserver") ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      construction.callee,
      construction.callee.name,
      scopes,
      undefined,
      true,
    )
  ) {
    return false;
  }

  const setup = readGuardedLookupIteration(observation, context);
  const cleanup = readGuardedLookupIteration(release, context);
  if (
    !setup ||
    !cleanup ||
    setup.collection !== cleanup.collection ||
    setup.guardStatements.length !== 2 ||
    cleanup.guardStatements.length !== 1
  ) {
    return false;
  }
  const ids = getDirectConstInitializer(setup.collection);
  if (
    !isNodeOfType(ids, "ArrayExpression") ||
    ids.elements.length !== 1 ||
    !isNodeOfType(ids.elements[0], "Literal") ||
    typeof ids.elements[0].value !== "string" ||
    ids.elements[0].value.length === 0 ||
    setup.collection.references.length !== 2 ||
    setup.collection.references.some(
      ({ identifier, flag }) =>
        flag !== "read" || (identifier !== setup.receiver && identifier !== cleanup.receiver),
    )
  ) {
    return false;
  }

  const captureStatement = setup.guardStatements[0];
  const capture = isNodeOfType(captureStatement, "ExpressionStatement")
    ? captureStatement.expression
    : null;
  if (
    !isNodeOfType(capture, "AssignmentExpression") ||
    capture.operator !== "=" ||
    !isNodeOfType(capture.left, "Identifier") ||
    !isNodeOfType(capture.right, "Identifier") ||
    scopes.symbolFor(capture.right) !== setup.target
  ) {
    return false;
  }
  const observed = scopes.symbolFor(capture.left);
  const effectBody = setup.statement.parent;
  const cleanupBody = cleanup.statement.parent;
  const returned = cleanupFunction.parent;
  if (
    observed?.kind !== "let" ||
    !isNodeOfType(observed.declarationNode, "VariableDeclarator") ||
    observed.declarationNode.id !== observed.bindingIdentifier ||
    observed.declarationNode.init ||
    !isNodeOfType(effectBody, "BlockStatement") ||
    observed.declarationNode.parent?.parent !== effectBody ||
    !isNodeOfType(returned, "ReturnStatement") ||
    returned.argument !== cleanupFunction ||
    returned.parent !== effectBody ||
    setup.statement.range[1] > returned.range[0] ||
    !isNodeOfType(cleanupBody, "BlockStatement") ||
    cleanupBody.parent !== cleanupFunction
  ) {
    return false;
  }
  const [
    idsStatement,
    observedStatement,
    observerStatement,
    observationStatement,
    returnStatement,
    otherSetup,
  ] = effectBody.body;
  if (
    otherSetup ||
    !isSingleDeclarationStatement(idsStatement, setup.collection.declarationNode) ||
    !isSingleDeclarationStatement(observedStatement, observed.declarationNode) ||
    !isSingleDeclarationStatement(observerStatement, observer.declarationNode) ||
    observationStatement !== setup.statement ||
    returnStatement !== returned
  ) {
    return false;
  }
  const cleanupIndex = cleanupBody.body.findIndex((statement) => statement === cleanup.statement);
  const guard = cleanupBody.body[cleanupIndex - 1];
  if (
    cleanupIndex !== cleanupBody.body.length - 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "ReturnStatement") ||
    guard.consequent.argument ||
    !isNativeDocumentCall(guard.test, "contains", context) ||
    guard.test.arguments.length !== 1 ||
    !isNodeOfType(guard.test.arguments[0], "Identifier") ||
    scopes.symbolFor(guard.test.arguments[0]) !== observed
  ) {
    return false;
  }
  const containsReceiver = getDirectMemberReceiver(guard.test, "contains");
  const replacement = readDetachedReplacementRoles(
    cleanupBody.body.slice(0, cleanupIndex - 1),
    observed,
    ids.elements[0].value,
    context,
  );
  if (!containsReceiver || !replacement) return false;
  const containsArgument = guard.test.arguments[0];
  if (
    !observed.references.every(({ identifier, flag }) => {
      if (identifier === capture.left) return flag === "write";
      return (
        flag === "read" &&
        (identifier === containsArgument ||
          identifier === replacement.existenceCheck ||
          identifier === replacement.replaceReceiver)
      );
    })
  ) {
    return false;
  }
  const documentReceivers = [
    setup.documentReceiver,
    cleanup.documentReceiver,
    containsReceiver,
    replacement.documentReceiver,
  ];
  const providerRoles = readDetachedProviderRoles(scopes, documentReceivers.length);
  return Boolean(
    providerRoles &&
    (!providerRoles.observerConstructor ||
      providerRoles.observerConstructor === construction.callee) &&
    [...providerRoles.documentReceivers].every((receiver) =>
      documentReceivers.some((documentReceiver) => receiver === documentReceiver),
    ),
  );
};
