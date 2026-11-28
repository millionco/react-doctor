import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
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

const isForwardingHtml = (node: EsTreeNode | null | undefined): boolean => {
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

const hasJsxOnlyReferences = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  symbol.references.length > 0 &&
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  symbol.references.every(({ identifier, flag }) => {
    const parent = identifier.parent;
    return (
      flag === "read" &&
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    );
  });

const localForwardingBySymbol = new WeakMap<SymbolDescriptor, boolean>();

const forwardsChildrenToFixedHtml = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const declaration = symbol.declarationNode;
  const initializer = getDirectConstInitializer(symbol);
  const definition = initializer ? stripParenExpression(initializer) : declaration;
  if (
    !isFunctionLike(definition) ||
    definition.async ||
    ("generator" in definition && definition.generator)
  ) {
    return false;
  }
  const statement = initializer ? declaration.parent : declaration;
  if (statement?.parent !== scopes.rootScope.node || !hasJsxOnlyReferences(symbol, scopes))
    return false;

  const parameter = definition.params[0];
  if (
    definition.params.length !== 1 ||
    !isNodeOfType(parameter, "ObjectPattern") ||
    parameter.properties.length !== 1
  )
    return false;
  const property = parameter.properties[0];
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    getStaticPropertyKeyName(property) !== "children" ||
    !isNodeOfType(property.value, "Identifier")
  ) {
    return false;
  }
  const binding = scopes.symbolFor(property.value);
  const reference = binding?.references[0];
  if (
    !binding ||
    binding.references.length !== 1 ||
    !reference ||
    reference.flag !== "read" ||
    !hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes)
  )
    return false;
  const root = getSingleReturnExpression(definition);
  let child = reference.identifier.parent;
  if (!isNodeOfType(child, "JSXExpressionContainer") || child.expression !== reference.identifier)
    return false;
  while (child && child !== root) {
    const parent: EsTreeNode | null | undefined = child.parent;
    if (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment")) return false;
    if (
      !isForwardingHtml(parent) ||
      !parent.children.some((entry) => entry === child) ||
      parent.children.some(
        (sibling) =>
          sibling !== child && (!isNodeOfType(sibling, "JSXText") || sibling.value.trim() !== ""),
      )
    )
      return false;
    if (
      isNodeOfType(parent, "JSXElement") &&
      parent.openingElement.attributes.some(
        (attribute) =>
          !isNodeOfType(attribute, "JSXAttribute") ||
          !isNodeOfType(attribute.name, "JSXIdentifier") ||
          attribute.name.name === "children" ||
          attribute.name.name === "dangerouslySetInnerHTML" ||
          (attribute.value !== null && !isNodeOfType(attribute.value, "Literal")),
      )
    )
      return false;
    child = parent;
  }
  return child === root && isForwardingHtml(root);
};

const isForwardingJsx = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"JSXElement" | "JSXFragment"> => {
  if (isForwardingHtml(node)) return true;
  if (!isNodeOfType(node, "JSXElement")) return false;
  const { name, attributes } = node.openingElement;
  if (
    !isNodeOfType(name, "JSXIdentifier") ||
    attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        ["children", "ref", "is"].includes(attribute.name.name),
    )
  )
    return false;
  const symbol = scopes.symbolFor(name);
  if (!symbol) return false;
  const cached = localForwardingBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  const forwards = forwardsChildrenToFixedHtml(symbol, scopes);
  localForwardingBySymbol.set(symbol, forwards);
  return forwards;
};

const getForwardingJsxRoot = (
  initialChild: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let child = initialChild;
  while (child) {
    const parent = child.parent;
    if (!isForwardingJsx(parent, scopes) || !parent.children.some((entry) => entry === child))
      break;
    child = parent;
  }
  return isNodeOfType(child, "JSXElement") || isNodeOfType(child, "JSXFragment") ? child : null;
};

const getReturningFunction = (tree: EsTreeNode | null): EsTreeNode | null => {
  const container = tree?.parent;
  if (isNodeOfType(container, "ReturnStatement") && container.argument === tree) {
    return findEnclosingFunction(container);
  }
  return isNodeOfType(container, "ArrowFunctionExpression") && container.body === tree
    ? container
    : null;
};

const isReactDomRootFactory = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const binding = scopes.symbolFor(node.callee);
  if (!binding || !isNodeOfType(binding.declarationNode, "ImportSpecifier")) return false;
  const imported = resolveImportedApiReference(node.callee, scopes);
  return imported?.source === "react-dom/client" && imported.importedName === "createRoot";
};

const getRootMethod = (receiver: EsTreeNode): string | null => {
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier")
  )
    return null;
  const call = member.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === member && !call.optional
    ? member.property.name
    : null;
};

const isOwnedReactRootRender = (tree: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const call = tree.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== tree ||
    !isNodeOfType(call.callee, "MemberExpression")
  )
    return false;
  const receiver = call.callee.object;
  if (getRootMethod(receiver) !== "render") return false;
  if (isReactDomRootFactory(receiver, scopes)) return true;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const root = scopes.symbolFor(receiver);
  if (!root) return false;
  const declarationContainer = root.declarationNode.parent?.parent;
  if (
    !isNodeOfType(declarationContainer, "Program") &&
    !isNodeOfType(declarationContainer, "BlockStatement")
  )
    return false;
  const initializer = getDirectConstInitializer(root);
  if (!initializer || !isReactDomRootFactory(initializer, scopes)) return false;
  return (
    hasCompleteSymbolReferences(root, scopes.rootScope.node, scopes) &&
    root.references.every(
      ({ identifier, flag }) =>
        flag === "read" && ["render", "unmount"].includes(getRootMethod(identifier) ?? ""),
    )
  );
};

const hasPrivateJsxRenderOwner = (
  map: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const component = getReturningFunction(getForwardingJsxRoot(map.parent, scopes));
  if (!component) return false;
  const remaining = [component];
  const visited = new Set<EsTreeNode>();
  let foundRoot = false;
  while (remaining.length > 0) {
    const ownerFunction = remaining.pop();
    if (!ownerFunction || visited.has(ownerFunction)) continue;
    visited.add(ownerFunction);
    const [owner] = getFunctionBindingSymbols(ownerFunction, scopes);
    if (!owner || !hasJsxOnlyReferences(owner, scopes)) return false;
    const declaration = owner.declarationNode;
    if (isNodeOfType(ownerFunction, "FunctionDeclaration")) {
      if (declaration !== ownerFunction || declaration.parent !== program) return false;
    } else if (
      getDirectConstInitializer(owner) !== ownerFunction ||
      declaration.parent?.parent !== program
    ) {
      return false;
    }
    for (const { identifier } of owner.references) {
      if (!isNodeOfType(identifier.parent, "JSXOpeningElement")) continue;
      const tree = getForwardingJsxRoot(identifier.parent.parent, scopes);
      if (!tree) return false;
      if (isOwnedReactRootRender(tree, scopes)) {
        foundRoot = true;
        continue;
      }
      const parentComponent = getReturningFunction(tree);
      if (!parentComponent) return false;
      remaining.push(parentComponent);
    }
  }
  return foundRoot;
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

  return getForwardingJsxRoot(innerCall.parent, scopes) === callback.body;
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
