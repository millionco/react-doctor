import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import { resolveUniqueDirectModuleFile } from "../../../utils/resolve-relative-import-path.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { serializeReferenceKey } from "../../../utils/serialize-reference-key.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const IMPORTED_WINDOW_GETTER_KEY_PREFIX = "imported-window-getter:";

const WINDOW_ACCESS_NAMES: ReadonlySet<string> = new Set([
  "window",
  "self",
  "global",
  "globalThis",
  "document",
  "top",
  "parent",
  "frames",
  "opener",
  "ownerDocument",
  "defaultView",
  "contentWindow",
  "contentDocument",
  "EventTarget",
  "Window",
  "Object",
  "Reflect",
  "Proxy",
  "Array",
  "eval",
  "Function",
  "require",
  "__proto__",
  "prototype",
  "constructor",
]);

interface WindowReceiver {
  readonly getter: EsTreeNodeOfType<"CallExpression">;
  readonly method: EsTreeNodeOfType<"MemberExpression">;
  readonly symbol: SymbolDescriptor;
  readonly handlerName: string;
}

const readListenerWindowReceiver = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): WindowReceiver | null => {
  if (call.optional || call.arguments.length < 2 || call.arguments.length > 3) return null;
  const method = stripParenExpression(call.callee);
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.optional ||
    method.computed ||
    !isNodeOfType(method.property, "Identifier") ||
    (method.property.name !== "addEventListener" && method.property.name !== "removeEventListener")
  )
    return null;
  const [eventNode, handlerNode, captureNode] = call.arguments;
  const event = stripParenExpression(eventNode);
  const handler = stripParenExpression(handlerNode);
  const capture = captureNode && stripParenExpression(captureNode);
  if (
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(handler, "MemberExpression") ||
    handler.optional ||
    handler.computed ||
    !isNodeOfType(handler.property, "Identifier") ||
    !isNodeOfType(stripParenExpression(handler.object), "ThisExpression") ||
    (capture && (!isNodeOfType(capture, "Literal") || typeof capture.value !== "boolean"))
  )
    return null;
  const getter = stripParenExpression(method.object);
  if (
    !isNodeOfType(getter, "CallExpression") ||
    getter.optional ||
    getter.arguments.length !== 0 ||
    !isNodeOfType(getter.callee, "Identifier")
  )
    return null;
  const symbol = scopes.symbolFor(getter.callee);
  return symbol && isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
    ? { getter, method, symbol, handlerName: handler.property.name }
    : null;
};

export const getWindowReceiverListenerCall = (
  getter: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const receiver = findTransparentExpressionRoot(getter);
  const method = receiver.parent;
  if (!isNodeOfType(method, "MemberExpression") || method.object !== receiver) return null;
  const callee = findTransparentExpressionRoot(method);
  const call = callee.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === callee ? call : null;
};

const isReactArrayProp = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const member = stripParenExpression(node);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    !isNodeOfType(member.property, "Identifier")
  )
    return false;
  const props = stripParenExpression(member.object);
  if (
    !isNodeOfType(props, "MemberExpression") ||
    props.computed ||
    getStaticPropertyName(props) !== "props" ||
    !isNodeOfType(stripParenExpression(props.object), "ThisExpression")
  )
    return false;
  const owner = findEnclosingClass(member);
  if (!owner || !owner.superClass) return false;
  const api = resolveImportedApiReference(owner.superClass, scopes);
  if (
    api?.source !== "react" ||
    (api.importedName !== "Component" && api.importedName !== "PureComponent")
  )
    return false;
  const argumentsNode = owner.superTypeArguments;
  if (!isNodeOfType(argumentsNode, "TSTypeParameterInstantiation")) return false;
  const declaredProps = argumentsNode.params[0];
  if (
    !isNodeOfType(declaredProps, "TSTypeReference") ||
    !isNodeOfType(declaredProps.typeName, "Identifier")
  )
    return false;
  const propertyName = member.property.name;
  let typeScope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(owner);
  while (typeScope) {
    const symbol = typeScope.symbolsByName.get(declaredProps.typeName.name);
    if (symbol) {
      const declaration = symbol.declarationNode;
      if (!isNodeOfType(declaration, "TSInterfaceDeclaration") || declaration.extends?.length)
        return false;
      const field = declaration.body.body.find(
        (item) =>
          isNodeOfType(item, "TSPropertySignature") &&
          !item.computed &&
          getStaticKeyName(item.key) === propertyName,
      );
      return (
        isNodeOfType(field, "TSPropertySignature") &&
        isNodeOfType(field.typeAnnotation?.typeAnnotation, "TSArrayType")
      );
    }
    typeScope = typeScope.parent;
  }
  return false;
};

const getArrayMapIndexReceiver = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (symbol.kind !== "parameter" || !isSymbolReadOnly(symbol)) return null;
  const callback = symbol.scope.node;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params[1] !== symbol.bindingIdentifier
  )
    return null;
  const call = callback.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments[0] !== callback ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    getStaticPropertyName(call.callee) !== "map"
  )
    return null;
  const receiver = stripParenExpression(call.callee.object);
  return isReactArrayProp(receiver, scopes) ? receiver : null;
};

const numericFieldArguments = new WeakMap<SymbolDescriptor, boolean>();

const hasOnlyNumericFieldArguments = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const cached = numericFieldArguments.get(symbol);
  if (cached !== undefined) return cached;
  const callback = symbol.scope.node;
  if (!isNodeOfType(callback, "ArrowFunctionExpression")) return false;
  const field = callback.parent;
  if (
    !isNodeOfType(field, "PropertyDefinition") ||
    field.value !== callback ||
    field.computed ||
    field.static ||
    !isNodeOfType(field.key, "Identifier")
  )
    return false;
  const owner = findEnclosingClass(field);
  const parameterIndex = callback.params.findIndex(
    (parameter) => parameter === symbol.bindingIdentifier,
  );
  if (!owner || parameterIndex < 0) return false;
  const fieldName = field.key.name;
  let foundCall = false;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "Property") &&
      isNodeOfType(node.parent, "ObjectPattern") &&
      getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true }) === fieldName
    ) {
      closed = false;
      return false;
    }
    if (
      !isNodeOfType(node, "MemberExpression") ||
      getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true }) !== fieldName
    )
      return;
    const callee = findTransparentExpressionRoot(node);
    const call = callee.parent;
    if (
      node.computed ||
      node.optional ||
      !isNodeOfType(node.object, "ThisExpression") ||
      findEnclosingClass(node) !== owner ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== callee ||
      call.arguments
        .slice(0, parameterIndex + 1)
        .some((argument) => isNodeOfType(argument, "SpreadElement"))
    ) {
      closed = false;
      return false;
    }
    foundCall = true;
    const argument = call.arguments[parameterIndex];
    if (!argument) {
      closed = false;
      return false;
    }
    const input = stripParenExpression(argument);
    if (isNodeOfType(input, "Literal") && typeof input.value === "number") return;
    const index = isNodeOfType(input, "Identifier") ? scopes.symbolFor(input) : null;
    if (!index || !getArrayMapIndexReceiver(index, scopes)) {
      closed = false;
      return false;
    }
  });
  const proven = closed && foundCall;
  numericFieldArguments.set(symbol, proven);
  return proven;
};

const isBoundedComputedIndex = (
  member: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const index = stripParenExpression(member.property);
  if (!isNodeOfType(index, "Identifier")) return false;
  const symbol = scopes.symbolFor(index);
  if (symbol?.kind !== "parameter" || !isSymbolReadOnly(symbol)) return false;
  const indexed = stripParenExpression(member.object);
  if (
    isNodeOfType(indexed, "MemberExpression") &&
    !indexed.computed &&
    isNodeOfType(stripParenExpression(indexed.object), "ThisExpression") &&
    isWithinAssignmentTarget(member) &&
    hasOnlyNumericFieldArguments(symbol, scopes)
  )
    return true;

  const mapReceiver = getArrayMapIndexReceiver(symbol, scopes);
  if (mapReceiver) {
    const receiverKey = serializeReferenceKey({ node: mapReceiver, scopes });
    return (
      receiverKey !== null && receiverKey === serializeReferenceKey({ node: member.object, scopes })
    );
  }
  const callback = symbol.scope.node;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params[0] !== symbol.bindingIdentifier
  )
    return false;
  const call = callback.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments[0] !== callback ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    getStaticPropertyName(call.callee) !== "forEach" ||
    !isNodeOfType(indexed, "MemberExpression") ||
    getStaticPropertyName(indexed) !== "style" ||
    !isWithinAssignmentTarget(member)
  )
    return false;
  const receiver = stripParenExpression(call.callee.object);
  return (
    isNodeOfType(receiver, "ArrayExpression") &&
    receiver.elements.every(
      (item) =>
        isNodeOfType(item, "Literal") &&
        typeof item.value === "string" &&
        !WINDOW_ACCESS_NAMES.has(item.value) &&
        item.value !== "addEventListener" &&
        item.value !== "removeEventListener",
    )
  );
};

const hasClosedWindowGetterUses = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  if (!hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)) return false;
  const permittedMethods = new Set<EsTreeNode>();
  const handlerNames = new Set<string>();
  for (const { flag, identifier } of symbol.references) {
    if (isKeyedDraftTypeReference(identifier)) continue;
    const getter = identifier.parent;
    if (flag !== "read" || !isNodeOfType(getter, "CallExpression") || getter.callee !== identifier)
      return false;
    const call = getWindowReceiverListenerCall(getter);
    const receiver = call && readListenerWindowReceiver(call, scopes);
    if (!receiver || receiver.getter !== getter || receiver.symbol !== symbol) return false;
    permittedMethods.add(receiver.method);
    handlerNames.add(receiver.handlerName);
  }

  let exposed = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (exposed || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "Decorator") ||
      isNodeOfType(node, "TSImportEqualsDeclaration")
    ) {
      exposed = true;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression") || isNodeOfType(node, "Property")) {
      const name = getResolvedStaticPropertyName(node, scopes, {
        allowConstTemplateLiteral: true,
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        (name !== null && WINDOW_ACCESS_NAMES.has(name)) ||
        ((name === "addEventListener" || name === "removeEventListener") &&
          !permittedMethods.has(node)) ||
        ((name === "map" || name === "forEach") &&
          isNodeOfType(node, "MemberExpression") &&
          isWithinAssignmentTarget(node)) ||
        (name !== null &&
          handlerNames.has(name) &&
          isNodeOfType(node, "MemberExpression") &&
          isNodeOfType(stripParenExpression(node.object), "ThisExpression") &&
          isWithinAssignmentTarget(node)) ||
        (name === null &&
          node.computed &&
          (!isNodeOfType(node, "MemberExpression") || !isBoundedComputedIndex(node, scopes)))
      ) {
        exposed = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.referenceFor(node) &&
      WINDOW_ACCESS_NAMES.has(node.name)
    ) {
      exposed = true;
      return false;
    }
  });
  return !exposed;
};

const isWindowGetterModule = (filename: string, source: string): boolean => {
  const resolved = resolveUniqueDirectModuleFile(path.resolve(path.dirname(filename), source));
  if (!resolved) return false;
  const program = parseSourceFile(resolved);
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return false;
  const statement = program.body[0];
  if (!isNodeOfType(statement, "ExportDefaultDeclaration")) return false;
  const getter = statement.declaration;
  if (
    !isNodeOfType(getter, "ArrowFunctionExpression") ||
    getter.async ||
    getter.params.length !== 0
  )
    return false;
  const value = stripParenExpression(getter.body);
  return isNodeOfType(value, "Identifier") && value.name === "window";
};

const provenWindowGetters = new WeakMap<SymbolDescriptor, boolean>();

export const getImportedWindowListenerReceiverKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): string | null => {
  if (!filename || !path.isAbsolute(filename)) return null;
  const receiver = readListenerWindowReceiver(call, scopes);
  if (!receiver) return null;
  const { symbol } = receiver;
  let proven = provenWindowGetters.get(symbol);
  if (proven === undefined) {
    const declaration = getImportDeclarationForSymbol(symbol);
    const source = declaration?.source.value;
    proven =
      declaration?.importKind !== "type" &&
      typeof source === "string" &&
      (source.startsWith("./") || source.startsWith("../")) &&
      !/[?#\\]/.test(source) &&
      hasClosedWindowGetterUses(symbol, scopes) &&
      isWindowGetterModule(filename, source);
    provenWindowGetters.set(symbol, proven);
  }
  return proven ? IMPORTED_WINDOW_GETTER_KEY_PREFIX + symbol.id : null;
};
