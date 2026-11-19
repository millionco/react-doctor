import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isPropertyNamePosition } from "../../../utils/is-property-name-position.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EffectStateWriteSite } from "./collect-effect-state-write-facts.js";

const MAX_PROJECTION_DEPTH = 8;
const DOM_SCALAR_PROPERTIES = new Set(["id", "tagName", "textContent"]);
const PROTOCOL_GLOBALS = new Set([
  "Array",
  "CustomElementRegistry",
  "Document",
  "Element",
  "EventTarget",
  "Function",
  "HTMLElement",
  "HTMLHeadingElement",
  "Node",
  "NodeList",
  "Object",
  "Reflect",
  "String",
  "Symbol",
  "Window",
  "customElements",
  "eval",
  "frames",
  "global",
  "globalThis",
  "opener",
  "parent",
  "self",
  "top",
  "window",
]);
const PROTOCOL_AUTHORITY_KEYS = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "contentDocument",
  "contentWindow",
  "defaultView",
  "defineProperties",
  "defineProperty",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getPrototypeOf",
  "ownerDocument",
  "prototype",
  "setPrototypeOf",
]);
const PROTOCOL_MEMBER_NAMES = new Set([
  ...DOM_SCALAR_PROPERTIES,
  "forEach",
  "push",
  "querySelectorAll",
  "replace",
]);
const closedProtocolByScopes = new WeakMap<ScopeAnalysis, boolean>();

const isStringLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "string";

const isDirectMember = (
  node: EsTreeNode | null | undefined,
  name: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  !node.computed &&
  getStaticPropertyName(node) === name;

const getDirectMemberInvocation = (
  node: EsTreeNode | null | undefined,
  name: string,
  arity: number,
) => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== arity ||
    !isDirectMember(node.callee, name)
  ) {
    return null;
  }
  return { receiver: node.callee.object, arguments: node.arguments };
};

const getDirectConst = (statement: EsTreeNode | undefined, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.declarations.length !== 1)
    return null;
  const [declaration] = statement.declarations;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return null;
  const symbol = scopes.symbolFor(declaration.id);
  const initializer = symbol ? getDirectConstInitializer(symbol) : null;
  return symbol && initializer ? { symbol, initializer } : null;
};

const hasOnlyReads = (
  symbol: SymbolDescriptor,
  references: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.length === references.length &&
  references.every(
    (identifier) =>
      scopes.symbolFor(identifier) === symbol && scopes.referenceFor(identifier)?.flag === "read",
  ) &&
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes);

const isProtocolAuthorityKey = (name: string | null): boolean =>
  name !== null && (PROTOCOL_GLOBALS.has(name) || PROTOCOL_AUTHORITY_KEYS.has(name));

const hasProtocolAuthorityOrWrite = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Property")) {
    const name = getStaticKeyName(node.key);
    return (
      node.computed ||
      isProtocolAuthorityKey(name) ||
      (node.kind !== "init" && name !== null && DOM_SCALAR_PROPERTIES.has(name))
    );
  }
  if (
    isNodeOfType(node, "MethodDefinition") ||
    isNodeOfType(node, "PropertyDefinition") ||
    isNodeOfType(node, "AccessorProperty")
  ) {
    const name = getStaticKeyName(node.key);
    return node.computed || (name !== null && DOM_SCALAR_PROPERTIES.has(name));
  }
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const name = getStaticPropertyName(node);
  return (
    node.computed ||
    isProtocolAuthorityKey(name) ||
    (name !== null && PROTOCOL_MEMBER_NAMES.has(name) && isWithinAssignmentTarget(node))
  );
};

const hasClosedBrowserProtocols = (scopes: ScopeAnalysis): boolean => {
  const cached = closedProtocolByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
  // The built-in operations below must keep their normal behavior.
  // Reject source-visible alternate routes to the browser prototypes.
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "WithStatement") || hasProtocolAuthorityOrWrite(node)) {
      isClosed = false;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      isPropertyNamePosition(node) ||
      !scopes.isGlobalReference(node)
    )
      return;
    if (PROTOCOL_GLOBALS.has(node.name)) {
      isClosed = false;
      return false;
    }
    if (node.name === "document") {
      const member = node.parent;
      const call = member?.parent;
      isClosed =
        isDirectMember(member, "querySelectorAll") &&
        member.object === node &&
        isNodeOfType(call, "CallExpression") &&
        !call.optional &&
        call.callee === member;
    }
  });
  closedProtocolByScopes.set(scopes, isClosed);
  return isClosed;
};

interface CallbackProjection {
  readonly element: SymbolDescriptor;
  readonly locals: ReadonlySet<SymbolDescriptor>;
  readonly scopes: ScopeAnalysis;
}

const isDomScalarProjection = (
  expression: EsTreeNode,
  projection: CallbackProjection,
  depth = 0,
): boolean => {
  if (depth > MAX_PROJECTION_DEPTH) return false;
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "number" || typeof node.value === "string";
  }
  if (isNodeOfType(node, "Identifier")) {
    const symbol = projection.scopes.symbolFor(node);
    return symbol !== null && projection.locals.has(symbol);
  }
  if (isNodeOfType(node, "MemberExpression")) {
    return (
      !node.optional &&
      !node.computed &&
      DOM_SCALAR_PROPERTIES.has(getStaticPropertyName(node) ?? "") &&
      isNodeOfType(node.object, "Identifier") &&
      projection.scopes.symbolFor(node.object) === projection.element
    );
  }
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "+") {
    return isDomScalarProjection(node.argument, projection, depth + 1);
  }
  if (isNodeOfType(node, "BinaryExpression") && node.operator === "+") {
    return (
      isDomScalarProjection(node.left, projection, depth + 1) &&
      isDomScalarProjection(node.right, projection, depth + 1)
    );
  }
  const replacement = getDirectMemberInvocation(node, "replace", 2);
  return Boolean(
    replacement &&
    replacement.arguments.every(isStringLiteral) &&
    isDomScalarProjection(replacement.receiver, projection, depth + 1),
  );
};

const getClosedCallbackPush = (callback: EsTreeNode, scopes: ScopeAnalysis) => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length > MAX_PROJECTION_DEPTH
  ) {
    return null;
  }
  const element = scopes.symbolFor(callback.params[0]);
  const tail = callback.body.body.at(-1);
  if (!element || !isNodeOfType(tail, "ExpressionStatement")) return null;
  const push = getDirectMemberInvocation(tail.expression, "push", 1);
  const row = push?.arguments[0];
  if (!push || !isNodeOfType(row, "ObjectExpression") || row.properties.length === 0) return null;
  const locals = new Set<SymbolDescriptor>();
  const projection = { element, locals, scopes };
  for (const statement of callback.body.body.slice(0, -1)) {
    const local = getDirectConst(statement, scopes);
    if (!local || !isDomScalarProjection(local.initializer, projection)) return null;
    locals.add(local.symbol);
  }
  const hasClosedValue = row.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      property.kind === "init" &&
      !property.method &&
      !property.computed &&
      getStaticKeyName(property.key) !== "__proto__" &&
      isDomScalarProjection(property.value, projection),
  );
  return hasClosedValue ? push.receiver : null;
};

export const isClosedDomQueryAccumulatorWrite = (
  effectCallback: EsTreeNode | undefined,
  write: EffectStateWriteSite,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    !isNodeOfType(write.node, "CallExpression") ||
    write.node.optional ||
    write.node.arguments.length !== 1 ||
    write.node.arguments[0] !== write.value ||
    !isNodeOfType(write.value, "Identifier") ||
    !isNodeOfType(write.node.parent, "ExpressionStatement")
  ) {
    return false;
  }
  const statements: ReadonlyArray<EsTreeNode> = effectCallback.body.body;
  const sinkIndex = statements.indexOf(write.node.parent);
  if (sinkIndex < 3) return false;

  // Consecutive statements in the effect's own block give the producer a
  // direct path to this write. Other writes still use their own analysis.
  const [queryStatement, arrayStatement, iteratorStatement] = statements.slice(
    sinkIndex - 3,
    sinkIndex,
  );
  const query = getDirectConst(queryStatement, scopes);
  const array = getDirectConst(arrayStatement, scopes);
  if (
    !query ||
    !array ||
    !isNodeOfType(array.initializer, "ArrayExpression") ||
    array.initializer.elements.length !== 0 ||
    !isNodeOfType(iteratorStatement, "ExpressionStatement")
  ) {
    return false;
  }
  const iterator = getDirectMemberInvocation(iteratorStatement.expression, "forEach", 1);
  const browserQuery = getDirectMemberInvocation(query.initializer, "querySelectorAll", 1);
  if (
    !iterator ||
    !browserQuery ||
    !isNodeOfType(browserQuery.receiver, "Identifier") ||
    browserQuery.receiver.name !== "document" ||
    !isStringLiteral(browserQuery.arguments[0]) ||
    !hasOnlyReads(query.symbol, [iterator.receiver], scopes)
  ) {
    return false;
  }
  const pushReceiver = getClosedCallbackPush(iterator.arguments[0], scopes);
  return (
    pushReceiver !== null &&
    hasOnlyReads(array.symbol, [pushReceiver, write.value], scopes) &&
    hasClosedBrowserProtocols(scopes) &&
    isProvenUnmodifiedGlobalNamespaceReference(
      browserQuery.receiver,
      "document",
      scopes,
      "querySelectorAll",
      true,
    )
  );
};
