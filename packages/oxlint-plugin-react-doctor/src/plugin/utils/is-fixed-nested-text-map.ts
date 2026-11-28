import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const PROTOCOL_GLOBALS = new Set([
  "Array",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "global",
  "globalThis",
  "self",
  "window",
]);
const PROTOTYPE_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);
const standardArrayProtocolByScopes = new WeakMap<ScopeAnalysis, boolean>();

const usesStandardArrayProtocol = (scopes: ScopeAnalysis): boolean => {
  const cached = standardArrayProtocolByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let valid = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!valid) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") &&
        PROTOCOL_GLOBALS.has(node.name) &&
        scopes.isGlobalReference(node)) ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed || PROTOTYPE_PROPERTIES.has(getStaticPropertyKeyName(node) ?? "")))
    ) {
      valid = false;
      return false;
    }
  });
  standardArrayProtocolByScopes.set(scopes, valid);
  return valid;
};

const getDirectJsxMapCallback = (
  call: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    getStaticPropertyKeyName(call.callee) !== "map" ||
    !isNodeOfType(call.parent, "JSXExpressionContainer") ||
    call.parent.expression !== call ||
    !isNodeOfType(call.parent.parent, "JSXElement")
  )
    return null;
  const callback = call.arguments[0];
  return isNodeOfType(callback, "ArrowFunctionExpression") &&
    !callback.async &&
    isNodeOfType(callback.body, "JSXElement")
    ? callback
    : null;
};

const isForwardingJsx = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"JSXElement" | "JSXFragment"> => {
  if (isNodeOfType(node, "JSXFragment")) return true;
  if (!isNodeOfType(node, "JSXElement")) return false;
  const { name, attributes } = node.openingElement;
  return (
    isNodeOfType(name, "JSXIdentifier") &&
    HTML_TAGS.has(name.name) &&
    attributes.every(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name !== "is" &&
        attribute.name.name !== "ref",
    )
  );
};

const getForwardingJsxRoot = (map: EsTreeNode): EsTreeNode | null => {
  let child = map.parent;
  while (child) {
    const parent = child.parent;
    if (!isForwardingJsx(parent) || !parent.children.some((entry) => entry === child)) break;
    child = parent;
  }
  return isForwardingJsx(child) ? child : null;
};

const hasPrivateJsxRenderOwner = (
  map: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const tree = getForwardingJsxRoot(map);
  if (!tree) return false;
  const container = tree.parent;
  const component =
    isNodeOfType(container, "ReturnStatement") && container.argument === tree
      ? findEnclosingFunction(container)
      : isNodeOfType(container, "ArrowFunctionExpression") && container.body === tree
        ? container
        : null;
  if (!component) return false;
  const [owner] = getFunctionBindingSymbols(component, scopes);
  if (!owner || !owner.references.length) return false;
  const declaration = owner.declarationNode;
  if (isNodeOfType(component, "FunctionDeclaration")) {
    if (declaration !== component || declaration.parent !== program) return false;
  } else if (
    getDirectConstInitializer(owner) !== component ||
    declaration.parent?.parent !== program
  ) {
    return false;
  }

  return (
    hasCompleteSymbolReferences(owner, program, scopes) &&
    owner.references.every(({ identifier, flag }) => {
      const parent = identifier.parent;
      return (
        flag === "read" &&
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === identifier
      );
    })
  );
};

const hasStableOuterKey = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression">,
  innerCall: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(callback.body, "JSXElement")) return false;
  const outerIndex = callback.params[1];
  if (!isNodeOfType(outerIndex, "Identifier")) return false;
  const attributes = callback.body.openingElement.attributes;
  const attribute = attributes[0];
  if (
    attributes.length !== 1 ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "key" ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "Identifier")
  ) {
    return false;
  }
  const index = scopes.symbolFor(attribute.value.expression);
  if (
    !index ||
    index.bindingIdentifier !== outerIndex ||
    index.references.length !== 1 ||
    index.references[0].flag !== "read"
  ) {
    return false;
  }

  return getForwardingJsxRoot(innerCall) === callback.body;
};

const isStringLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "string";

const hasLiteralFields = (
  row: EsTreeNode | null,
  fields: ReadonlySet<string>,
  textField: string,
): boolean => {
  if (!isNodeOfType(row, "ObjectExpression")) return false;
  const seen = new Set<string>();
  for (const property of row.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (!name || PROTOTYPE_PROPERTIES.has(name) || seen.has(name)) return false;
    seen.add(name);
    if (name === textField) {
      if (
        !isNodeOfType(property.value, "ArrayExpression") ||
        !property.value.elements.every(isStringLiteral)
      )
        return false;
    } else if (!isStringLiteral(property.value)) return false;
  }
  return [...fields].every((field) => seen.has(field));
};

export const isFixedNestedTextMap = (
  call: EsTreeNodeOfType<"CallExpression">,
  key: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  const callback = getDirectJsxMapCallback(call);
  if (
    !callback ||
    !isNodeOfType(callback.body, "JSXElement") ||
    callback.params.length !== 2 ||
    !isNodeOfType(call.callee, "MemberExpression")
  )
    return false;
  const [text, index] = callback.params;
  const { openingElement, children } = callback.body;
  const [child] = children;
  const receiver = call.callee.object;
  if (
    !isNodeOfType(text, "Identifier") ||
    !isNodeOfType(index, "Identifier") ||
    !isNodeOfType(receiver, "Identifier") ||
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    openingElement.attributes.length !== 1 ||
    openingElement.attributes[0] !== key ||
    !isNodeOfType(key.value, "JSXExpressionContainer") ||
    !isNodeOfType(key.value.expression, "Identifier") ||
    scopes.symbolFor(key.value.expression)?.bindingIdentifier !== index ||
    children.length !== 1 ||
    !isNodeOfType(child, "JSXExpressionContainer") ||
    !isNodeOfType(child.expression, "Identifier") ||
    scopes.symbolFor(child.expression)?.bindingIdentifier !== text
  )
    return false;

  const outerCallback = findEnclosingFunction(call);
  const outerCall = outerCallback?.parent;
  if (
    !isNodeOfType(outerCall, "CallExpression") ||
    getDirectJsxMapCallback(outerCall) !== outerCallback ||
    !isNodeOfType(outerCallback, "ArrowFunctionExpression") ||
    !isNodeOfType(outerCall.callee, "MemberExpression") ||
    !isNodeOfType(outerCall.callee.object, "Identifier") ||
    outerCallback.params.length !== 2 ||
    !hasStableOuterKey(outerCallback, call, scopes)
  )
    return false;
  const pattern = outerCallback.params[0];
  const receiverBinding = scopes.symbolFor(receiver);
  if (
    !isNodeOfType(pattern, "ObjectPattern") ||
    !receiverBinding ||
    receiverBinding.bindingIdentifier.parent?.parent !== pattern ||
    receiverBinding.references.length !== 1 ||
    receiverBinding.references[0].identifier !== receiver ||
    receiverBinding.references[0].flag !== "read"
  )
    return false;
  const textField = getDestructuredBindingPropertyName(receiverBinding.bindingIdentifier);
  if (!textField) return false;
  const fields = new Set<string>();
  for (const property of pattern.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (!name || fields.has(name)) return false;
    fields.add(name);
  }

  const tableUse = outerCall.callee.object;
  const table = scopes.symbolFor(tableUse);
  if (
    !table ||
    !isNodeOfType(table.declarationNode.parent?.parent, "Program") ||
    table.declarationNode.parent.parent.sourceType !== "module" ||
    table.references.length !== 1 ||
    table.references[0].identifier !== tableUse ||
    table.references[0].flag !== "read"
  )
    return false;
  const program = table.declarationNode.parent.parent;
  if (
    !hasCompleteSymbolReferences(table, program, scopes) ||
    !hasCompleteSymbolReferences(receiverBinding, program, scopes) ||
    !hasPrivateJsxRenderOwner(outerCall, program, scopes)
  )
    return false;
  const rows = getDirectConstInitializer(table);
  // Both maps are JSX children. The table and the projected array have no
  // other reads, so neither can escape, reorder, or change between renders.
  return (
    isNodeOfType(rows, "ArrayExpression") &&
    rows.elements.every((row) => hasLiteralFields(row, fields, textField)) &&
    usesStandardArrayProtocol(scopes)
  );
};
