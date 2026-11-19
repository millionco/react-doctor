import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPureEventBlockerHandler } from "./is-pure-event-blocker-handler.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const MAX_ARRAY_LENGTH = 2 ** 32 - 1;
const MAX_RENDER_DEPTH = 20;
const ARRAY_PROTOCOL_NAMES = new Set([
  "Function",
  "Object",
  "Proxy",
  "Reflect",
  "Symbol",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "contentDocument",
  "contentWindow",
  "defaultView",
  "defineProperty",
  "eval",
  "frames",
  "getPrototypeOf",
  "global",
  "globalThis",
  "opener",
  "ownerDocument",
  "parent",
  "prototype",
  "require",
  "self",
  "setPrototypeOf",
  "top",
  "window",
]);
const stockArrayProtocolByScopes = new WeakMap<ScopeAnalysis, boolean>();

const isDirectCallCallee = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "CallExpression") &&
  node.parent.callee === node &&
  !node.parent.optional;

const hasStockArrayProtocol = (scopes: ScopeAnalysis): boolean => {
  const known = stockArrayProtocolByScopes.get(scopes);
  if (known !== undefined) return known;
  const root = scopes.rootScope.node;
  if (!isNodeOfType(root, "Program") || root.sourceType !== "module") return false;
  let stock = true;
  walkAst(root, (node) => {
    if (!stock) return false;
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression"))
      stock = false;
    if (isNodeOfType(node, "Property")) {
      stock = !node.computed && !ARRAY_PROTOCOL_NAMES.has(getStaticKeyName(node.key) ?? "");
    }
    if (isNodeOfType(node, "MemberExpression")) {
      stock = !node.computed && !ARRAY_PROTOCOL_NAMES.has(getStaticPropertyName(node) ?? "");
    }
    if (!isNodeOfType(node, "Identifier")) return;
    if (ARRAY_PROTOCOL_NAMES.has(node.name)) {
      stock = false;
      return;
    }
    if (node.name === "Array" && scopes.isGlobalReference(node)) {
      const member = node.parent;
      stock =
        isDirectCallCallee(node) ||
        (isNodeOfType(member, "MemberExpression") &&
          member.object === node &&
          !member.computed &&
          !member.optional &&
          getStaticPropertyName(member) === "from" &&
          isDirectCallCallee(member));
    }
  });
  stockArrayProtocolByScopes.set(scopes, stock);
  return stock;
};

const isNativeJsxParent = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "JSXElement") &&
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  /^[a-z][a-z0-9]*$/.test(node.openingElement.name.name) &&
  node.openingElement.attributes.every(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name !== "is" &&
      attribute.name.name !== "ref",
  );

const getFixedCountMapper = (call: EsTreeNode, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 2)
    return null;
  const { callee, parent } = call;
  const [source, mapper] = call.arguments;
  if (
    !isNodeOfType(parent, "JSXExpressionContainer") ||
    parent.expression !== call ||
    !isNativeJsxParent(parent.parent) ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.object, "Identifier") ||
    callee.object.name !== "Array" ||
    !scopes.isGlobalReference(callee.object) ||
    getStaticPropertyName(callee) !== "from" ||
    !isNodeOfType(source, "CallExpression") ||
    source.optional ||
    !isNodeOfType(source.callee, "Identifier") ||
    source.callee.name !== "Array" ||
    !scopes.isGlobalReference(source.callee) ||
    source.arguments.length !== 1 ||
    !isNodeOfType(mapper, "ArrowFunctionExpression") ||
    mapper.async ||
    mapper.params.length !== 2 ||
    !isNodeOfType(mapper.body, "JSXElement")
  ) {
    return null;
  }
  const [length] = source.arguments;
  const [item, position] = mapper.params;
  if (
    !isNodeOfType(length, "Literal") ||
    typeof length.value !== "number" ||
    !Number.isInteger(length.value) ||
    length.value < 0 ||
    length.value > MAX_ARRAY_LENGTH ||
    !isNodeOfType(item, "Identifier") ||
    !isNodeOfType(position, "Identifier")
  ) {
    return null;
  }
  const itemSymbol = scopes.symbolFor(item);
  const positionSymbol = scopes.symbolFor(position);
  return itemSymbol &&
    positionSymbol &&
    itemSymbol.references.length === 0 &&
    hasCompleteSymbolReferences(itemSymbol, scopes.rootScope.node, scopes)
    ? { mapper, body: mapper.body, positionSymbol, array: callee.object }
    : null;
};

const getNativeJsxRoot = (iterator: EsTreeNode): EsTreeNode | null => {
  const container = iterator.parent;
  if (!isNodeOfType(container, "JSXExpressionContainer")) return null;

  let child: EsTreeNode = container;
  while (isNodeOfType(child.parent, "JSXElement")) {
    const host: EsTreeNodeOfType<"JSXElement"> = child.parent;
    if (!host.children.some((candidate) => candidate === child) || !isNativeJsxParent(host))
      return null;
    child = host;
  }
  return isNodeOfType(child, "JSXElement") ? child : null;
};

const hasOnlyJsxComponentReads = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  symbol.references.every(({ identifier, flag }) => {
    const parent = identifier.parent;
    return (
      flag === "read" &&
      isNodeOfType(identifier, "JSXIdentifier") &&
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    );
  });

const isModuleDeclaration = (declaration: EsTreeNode): boolean => {
  const parent = declaration.parent;
  return isNodeOfType(
    isNodeOfType(parent, "ExportNamedDeclaration") ||
      isNodeOfType(parent, "ExportDefaultDeclaration")
      ? parent.parent
      : parent,
    "Program",
  );
};

const getStockMemoCall = (
  renderer: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): EsTreeNode | null => {
  const call = renderer.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== renderer ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isNodeOfType(scopes.symbolFor(call.callee)?.declarationNode, "ImportSpecifier")
  ) {
    return null;
  }
  const api = resolveImportedApiReference(call.callee, scopes);
  const program = scopes.rootScope.node;
  if (
    api?.source !== "react" ||
    api.importedName !== "memo" ||
    !filename ||
    !isNodeOfType(program, "Program") ||
    resolveModulePath(filename, "react")
  ) {
    return null;
  }
  // A local module cannot inspect the complete runtime loader, but its
  // explicit alternate React objects and re-exports can expose memo.
  const exposesReactProvider = program.body.some((statement) => {
    if (
      isNodeOfType(statement, "ExportNamedDeclaration") ||
      isNodeOfType(statement, "ExportAllDeclaration")
    ) {
      return statement.source?.value === "react";
    }
    return (
      isNodeOfType(statement, "ImportDeclaration") &&
      statement.source.value === "react" &&
      statement.specifiers.some(
        (specifier) =>
          !isNodeOfType(specifier, "ImportSpecifier") ||
          resolveImportedApiReference(specifier.local, scopes)?.importedName === "default",
      )
    );
  });
  return exposesReactProvider ? null : call;
};

const isDirectComponentRoot = (
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  if (!isFunctionLike(owner) || owner.async || owner.generator) return false;
  if (isNodeOfType(owner, "FunctionDeclaration")) {
    if (!owner.id || !isUppercaseName(owner.id.name) || !isNodeOfType(owner.parent, "Program")) {
      return false;
    }
    const outer = scopes.scopeFor(owner).symbolsByName.get(owner.id.name);
    const inner = scopes.ownScopeFor(owner)?.symbolsByName.get(owner.id.name);
    return Boolean(
      outer &&
      inner &&
      hasOnlyJsxComponentReads(outer, scopes) &&
      hasOnlyJsxComponentReads(inner, scopes),
    );
  }
  const renderer = findTransparentExpressionRoot(owner);
  const memo = getStockMemoCall(renderer, scopes, filename);
  const value = findTransparentExpressionRoot(memo ?? renderer);
  const declarator = value.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== value ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isUppercaseName(declarator.id.name) ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isModuleDeclaration(declarator.parent) ||
    (!memo && !isNodeOfType(declarator.parent.parent, "Program"))
  ) {
    return false;
  }
  if (isNodeOfType(owner, "FunctionExpression") && owner.id) {
    const inner = scopes.ownScopeFor(owner)?.symbolsByName.get(owner.id.name);
    if (!inner || !hasOnlyJsxComponentReads(inner, scopes)) return false;
  }
  const outer = scopes.symbolFor(declarator.id);
  return outer !== null && hasOnlyJsxComponentReads(outer, scopes);
};

const getRootFixedMapper = (
  iterator: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
) => {
  let current = iterator;
  for (let depth = 0; depth < MAX_RENDER_DEPTH; depth += 1) {
    const mapper = getFixedCountMapper(current, scopes);
    const jsx = getNativeJsxRoot(current);
    const owner = jsx && findEnclosingFunction(jsx);
    const returned = owner && getSingleReturnExpression(owner);
    if (!mapper || !jsx || !owner || !returned || stripParenExpression(returned) !== jsx)
      return null;
    if (isDirectComponentRoot(owner, scopes, filename)) return mapper;

    const outerCall = owner.parent;
    if (!isNodeOfType(outerCall, "CallExpression")) return null;
    const outerMapper = getFixedCountMapper(outerCall, scopes);
    if (outerMapper?.mapper !== owner) return null;
    current = outerCall;
  }
  return null;
};

const isClosedOrdinalJsx = (
  node: EsTreeNode,
  indexes: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
  depth: number,
): boolean => {
  if (depth > MAX_RENDER_DEPTH) return false;
  const isClosedChild = (child: EsTreeNode): boolean =>
    isClosedOrdinalJsx(child, indexes, scopes, depth + 1);
  if (isNodeOfType(node, "Identifier")) {
    const symbol = scopes.symbolFor(node);
    return symbol !== null && indexes.has(symbol);
  }
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "number" || typeof node.value === "string";
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    return node.operator === "+" && isClosedChild(node.left) && isClosedChild(node.right);
  }
  if (isNodeOfType(node, "TemplateLiteral")) return node.expressions.every(isClosedChild);
  if (isNodeOfType(node, "JSXText") || isNodeOfType(node, "JSXEmptyExpression")) return true;
  if (isNodeOfType(node, "JSXExpressionContainer")) return isClosedChild(node.expression);
  if (isNodeOfType(node, "JSXFragment")) return node.children.every(isClosedChild);
  if (isNodeOfType(node, "JSXElement")) {
    const opening = node.openingElement;
    return (
      isNodeOfType(opening.name, "JSXIdentifier") &&
      opening.attributes.every(isClosedChild) &&
      node.children.every(isClosedChild)
    );
  }
  if (isNodeOfType(node, "JSXAttribute")) {
    if (
      !isNodeOfType(node.name, "JSXIdentifier") ||
      node.name.name === "ref" ||
      node.name.name === "is"
    ) {
      return false;
    }
    const expression = node.value;
    if (!expression || isClosedChild(expression)) return true;
    return (
      node.name.name === "onClick" &&
      isNodeOfType(expression, "JSXExpressionContainer") &&
      isNodeOfType(expression.expression, "ArrowFunctionExpression") &&
      !expression.expression.async &&
      expression.expression.params.length === 1 &&
      isNodeOfType(expression.expression.params[0], "Identifier") &&
      isNodeOfType(expression.expression.body, "CallExpression") &&
      !expression.expression.body.optional &&
      expression.expression.body.arguments.length === 0 &&
      isNodeOfType(expression.expression.body.callee, "MemberExpression") &&
      !expression.expression.body.callee.computed &&
      !expression.expression.body.callee.optional &&
      isNodeOfType(expression.expression.body.callee.object, "Identifier") &&
      scopes.symbolFor(expression.expression.body.callee.object)?.bindingIdentifier ===
        expression.expression.params[0] &&
      isPureEventBlockerHandler(node)
    );
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  const nested = getFixedCountMapper(node, scopes);
  return (
    nested !== null &&
    isClosedOrdinalJsx(nested.body, new Set([...indexes, nested.positionSymbol]), scopes, depth + 1)
  );
};

export const isFixedArrayFromOrdinalKey = (
  iteratorCall: EsTreeNode,
  key: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  const renderer = getFixedCountMapper(iteratorCall, scopes);
  if (
    !renderer ||
    !isNodeOfType(key, "JSXAttribute") ||
    key.parent !== renderer.body.openingElement ||
    !isNodeOfType(key.value, "JSXExpressionContainer") ||
    !isNodeOfType(key.value.expression, "Identifier") ||
    scopes.symbolFor(key.value.expression) !== renderer.positionSymbol
  ) {
    return false;
  }
  // A fixed count provides stable slots within one unconditional renderer.
  // Alternate return pools and arrays passed through another component can
  // still give the same sibling keys to different logical items.
  const root = getRootFixedMapper(iteratorCall, scopes, filename);
  return (
    root !== null &&
    isClosedOrdinalJsx(root.body, new Set([root.positionSymbol]), scopes, 0) &&
    hasStockArrayProtocol(scopes) &&
    isProvenUnmodifiedGlobalNamespaceReference(root.array, "Array", scopes, "from", true)
  );
};
