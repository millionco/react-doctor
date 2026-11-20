import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";

const guardedGlobalNames = new Set([
  "global",
  "globalThis",
  "self",
  "document",
  "Window",
  "EventTarget",
  "frames",
  "parent",
  "opener",
  "frameElement",
  "addEventListener",
  "removeEventListener",
  "eval",
  "Function",
  "arguments",
  "Object",
  "Reflect",
  "require",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
]);
const guardedMemberNames = new Set([
  "window",
  "self",
  "defaultView",
  "ownerDocument",
  "nativeEvent",
  "view",
  "prototype",
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "innerWidth",
  "innerHeight",
  "addEventListener",
  "removeEventListener",
  "useState",
  "useEffect",
]);
const ownedSnapshotByDeclarator = new WeakMap<EsTreeNode, boolean>();

const isNamedReactCall = (
  node: EsTreeNode | null | undefined,
  name: string,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(node.callee);
  const declaration = symbol && getValueImportDeclaration(symbol);
  return Boolean(
    symbol &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    getImportedName(symbol.declarationNode) === name &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.source.value === "react" &&
    !declaration.attributes?.length &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const getPlainViewportValues = (node: EsTreeNode): readonly [EsTreeNode, EsTreeNode] | null => {
  if (!isNodeOfType(node, "ObjectExpression") || node.properties.length !== 2) return null;
  const [width, height] = node.properties;
  if (
    !isNodeOfType(width, "Property") ||
    width.computed ||
    width.kind !== "init" ||
    width.method ||
    !isNodeOfType(height, "Property") ||
    height.computed ||
    height.kind !== "init" ||
    height.method ||
    !isNodeOfType(width.key, "Identifier") ||
    width.key.name !== "width" ||
    !isNodeOfType(height.key, "Identifier") ||
    height.key.name !== "height"
  ) {
    return null;
  }
  return [width.value, height.value];
};

const getWindowMember = (node: EsTreeNode | null, name: string, scopes: ScopeAnalysis) => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.optional ||
    node.computed ||
    !isNodeOfType(node.property, "Identifier") ||
    node.property.name !== name ||
    !isNodeOfType(node.object, "Identifier") ||
    node.object.name !== "window" ||
    !scopes.isGlobalReference(node.object)
  ) {
    return null;
  }
  return node;
};

const getExpressionStatementCall = (statement: EsTreeNode | null | undefined) => {
  return isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(statement.expression, "CallExpression") &&
    !statement.expression.optional
    ? statement.expression
    : null;
};

const getViewportRead = (
  value: EsTreeNode,
  statement: EsTreeNode | undefined,
  name: string,
  scopes: ScopeAnalysis,
) => {
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = scopes.symbolFor(value);
  const initializer = symbol && getDirectConstInitializer(symbol);
  // A shorthand Property may expose both key and value to scope analysis.
  const property = value.parent;
  if (
    !symbol ||
    !initializer ||
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.declarations.length !== 1 ||
    symbol.declarationNode.parent !== statement ||
    !isNodeOfType(property, "Property") ||
    property.value !== value ||
    !symbol.references.some((reference) => reference.identifier === value) ||
    symbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        (reference.identifier !== value &&
          !(property.shorthand && reference.identifier === property.key)),
    )
  ) {
    return null;
  }
  return getWindowMember(initializer, name, scopes);
};

const getViewportWrite = (identifier: EsTreeNode, scopes: ScopeAnalysis) => {
  const statement = identifier.parent?.parent;
  const call = getExpressionStatementCall(statement);
  const block = statement?.parent;
  const callback = block?.parent;
  if (
    !call ||
    call.callee !== identifier ||
    call.arguments.length !== 1 ||
    !isNodeOfType(block, "BlockStatement") ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0
  ) {
    return null;
  }
  const values = getPlainViewportValues(call.arguments[0]);
  const position = block.body.findIndex((entry) => entry === statement);
  if (!values || position < 2) return null;
  const width = getViewportRead(values[0], block.body[position - 2], "innerWidth", scopes);
  const height = getViewportRead(values[1], block.body[position - 1], "innerHeight", scopes);
  return width && height ? { callback, block, position, width, height } : null;
};

const getResizeListener = (
  statement: EsTreeNode | undefined,
  method: "addEventListener" | "removeEventListener",
  scopes: ScopeAnalysis,
) => {
  const call = getExpressionStatementCall(statement);
  if (!call || call.arguments.length !== 2) return null;
  const [event, handler] = call.arguments;
  const member = getWindowMember(call.callee, method, scopes);
  if (
    !member ||
    !isNodeOfType(event, "Literal") ||
    event.value !== "resize" ||
    !isNodeOfType(handler, "Identifier")
  ) {
    return null;
  }
  return { member, handler };
};

const isErasedTypeReference = (node: EsTreeNode): boolean => {
  if (!isTypeScriptTypePosition(node)) return false;
  let parent = node.parent;
  while (isNodeOfType(parent, "TSQualifiedName")) parent = parent.parent;
  return isNodeOfType(parent, "TSTypeQuery") || isNodeOfType(parent, "TSTypeReference");
};

const isReactNamespaceValueReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(node);
  if (!symbol || symbol.bindingIdentifier === node || isErasedTypeReference(node)) return false;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "ImportNamespaceSpecifier") &&
    !isNodeOfType(declaration, "ImportDefaultSpecifier") &&
    !(isNodeOfType(declaration, "ImportSpecifier") && getImportedName(declaration) === "default")
  ) {
    return false;
  }
  const imported = getValueImportDeclaration(symbol);
  return isNodeOfType(imported, "ImportDeclaration") && imported.source.value === "react";
};

const isAmbientBinding = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (scopes.isGlobalReference(node)) return true;
  let declaration = scopes.symbolFor(node)?.declarationNode;
  while (declaration) {
    if ("declare" in declaration && declaration.declare === true) return true;
    if (isNodeOfType(declaration, "Program") || isNodeOfType(declaration, "BlockStatement")) break;
    declaration = declaration.parent ?? undefined;
  }
  return false;
};

const isClosedTimerReference = (node: EsTreeNodeOfType<"Identifier">): boolean => {
  if (isErasedTypeReference(node)) return true;
  const call = node.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== node) return false;
  if (node.name === "clearTimeout") return call.arguments.length === 1;
  return call.arguments.length === 2 && isNodeOfType(call.arguments[0], "ArrowFunctionExpression");
};

const hasClosedWindowReferences = (
  program: EsTreeNode,
  members: ReadonlyArray<EsTreeNodeOfType<"MemberExpression">>,
  scopes: ScopeAnalysis,
): boolean => {
  const admittedMembers = new Set<EsTreeNode>(members);
  const admittedReceivers = new Set<EsTreeNode>(members.map((member) => member.object));
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    // A browser timer can pass Window as `this` to an ordinary function.
    // Frame and event namespace aliases can expose the same receiver.
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration")
    ) {
      closed = false;
    } else if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      if (
        (node.name === "window" && !admittedReceivers.has(node)) ||
        (guardedGlobalNames.has(node.name) && isAmbientBinding(node, scopes)) ||
        ((node.name === "top" ||
          node.name === "event" ||
          node.name === "open" ||
          /^on[a-z]/.test(node.name)) &&
          isAmbientBinding(node, scopes)) ||
        isReactNamespaceValueReference(node, scopes)
      ) {
        closed = false;
      } else if (
        isNodeOfType(node, "Identifier") &&
        (node.name === "setTimeout" ||
          node.name === "clearTimeout" ||
          node.name === "setInterval") &&
        !isClosedTimerReference(node)
      ) {
        closed = false;
      }
    } else if (isNodeOfType(node, "MemberExpression") && !admittedMembers.has(node)) {
      const name = getResolvedStaticPropertyName(node, scopes);
      if (
        (name !== null && guardedMemberNames.has(name)) ||
        (node.computed &&
          name === null &&
          (isWithinAssignmentTarget(node) ||
            (isNodeOfType(node.parent, "CallExpression") && node.parent.callee === node)))
      ) {
        closed = false;
      }
    }
    return undefined;
  });
  return closed;
};

const matchesOwnedViewportSnapshot = (declarator: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    !isNamedReactCall(declarator.init, "useState", scopes) ||
    declarator.init.arguments.length !== 1
  ) {
    return false;
  }
  const [state, setter] = declarator.id.elements;
  const initial = getPlainViewportValues(declarator.init.arguments[0]);
  if (
    !isNodeOfType(state, "Identifier") ||
    !isNodeOfType(setter, "Identifier") ||
    !initial ||
    !initial.every((value) => isNodeOfType(value, "Literal") && typeof value.value === "number")
  ) {
    return false;
  }
  const setterSymbol = scopes.symbolFor(setter);
  const owner = findEnclosingFunction(declarator);
  const program = findProgramRoot(declarator);
  if (
    !program ||
    !setterSymbol ||
    setterSymbol.kind !== "const" ||
    setterSymbol.references.length !== 2 ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    declarator.parent?.parent !== owner.body ||
    !hasCompleteSymbolReferences(setterSymbol, program, scopes)
  ) {
    return false;
  }
  const writes = setterSymbol.references.map((reference) =>
    reference.flag === "read" ? getViewportWrite(reference.identifier, scopes) : null,
  );
  const mount = writes.find((write) => isNodeOfType(write?.callback.parent, "CallExpression"));
  const resize = writes.find((write) => isNodeOfType(write?.callback.parent, "VariableDeclarator"));
  if (
    !mount ||
    !resize ||
    mount.position !== 3 ||
    mount.block.body.length !== 5 ||
    resize.position !== 2 ||
    resize.block.body.length !== 3
  ) {
    return false;
  }
  const mountCall = mount.callback.parent;
  if (
    !isNamedReactCall(mountCall, "useEffect", scopes) ||
    mountCall.arguments.length !== 2 ||
    mountCall.arguments[0] !== mount.callback ||
    getExpressionStatementCall(mountCall.parent) !== mountCall ||
    mountCall.parent?.parent !== owner.body
  ) {
    return false;
  }
  const dependencies = mountCall.arguments[1];
  const returnCleanup = mount.block.body[4];
  if (
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 0 ||
    !isNodeOfType(returnCleanup, "ReturnStatement") ||
    !isNodeOfType(returnCleanup.argument, "ArrowFunctionExpression") ||
    returnCleanup.argument.async ||
    returnCleanup.argument.params.length !== 0 ||
    !isNodeOfType(returnCleanup.argument.body, "BlockStatement")
  ) {
    return false;
  }
  const add = getResizeListener(mount.block.body[0], "addEventListener", scopes);
  const remove = getResizeListener(
    returnCleanup.argument.body.body[0],
    "removeEventListener",
    scopes,
  );
  const handler = add && scopes.symbolFor(add.handler);
  if (
    !add ||
    !remove ||
    !handler ||
    handler.declarationNode.parent?.parent !== owner.body ||
    getDirectConstInitializer(handler) !== resize.callback ||
    scopes.symbolFor(remove.handler) !== handler ||
    !hasOnlyRegistrationReferences(handler, add.handler, remove.handler, program, scopes)
  ) {
    return false;
  }
  return hasClosedWindowReferences(
    program,
    [mount.width, mount.height, resize.width, resize.height, add.member, remove.member],
    scopes,
  );
};

const hasOnlyRegistrationReferences = (
  symbol: SymbolDescriptor,
  addReference: EsTreeNode,
  removeReference: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.length === 2 &&
  symbol.references.every(
    (reference) =>
      reference.flag === "read" &&
      (reference.identifier === addReference || reference.identifier === removeReference),
  ) &&
  hasCompleteSymbolReferences(symbol, program, scopes);

export const isOwnedViewportSnapshotState = (
  declarator: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const cached = ownedSnapshotByDeclarator.get(declarator);
  if (cached !== undefined) return cached;
  const result = matchesOwnedViewportSnapshot(declarator, scopes);
  ownedSnapshotByDeclarator.set(declarator, result);
  return result;
};
