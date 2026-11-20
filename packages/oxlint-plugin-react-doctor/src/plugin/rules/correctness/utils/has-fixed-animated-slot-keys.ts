import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const ANIMATION_METHODS = new Set(["timing", "sequence", "parallel", "loop"]);
const ARRAY_READ_METHODS = new Set(["map", "forEach"]);
const POSSIBLE_INTRINSIC_ALIASES = new Set([
  "Array",
  "Object",
  "Reflect",
  "eval",
  "require",
  "Function",
  "global",
  "globalThis",
  "window",
  "self",
  "jest",
  "vi",
]);

const isZero = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === 0;

const getNamedRuntimeImport = (
  node: EsTreeNode,
  module: string,
  importedName: string,
  context: RuleContext,
) => {
  const symbol = context.scopes.symbolFor(node);
  if (
    !symbol ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== importedName
  )
    return null;
  const declaration = getImportDeclarationForSymbol(symbol);
  return declaration?.source.value === module &&
    declaration.importKind !== "type" &&
    !declaration.attributes?.length
    ? symbol
    : null;
};

const hasClosedReadOnlyReferences = (symbol: SymbolDescriptor, context: RuleContext): boolean =>
  isSymbolReadOnly(symbol) &&
  hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes);

const getMethodCall = (node: EsTreeNode | null | undefined, method: string) => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    node.callee.optional ||
    getStaticPropertyName(node.callee) !== method
  )
    return null;
  return { call: node, receiver: node.callee.object };
};

const hasClosedAnimatedProvider = (provider: SymbolDescriptor, context: RuleContext): boolean =>
  hasClosedReadOnlyReferences(provider, context) &&
  provider.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (isNodeOfType(member, "JSXMemberExpression")) {
      return member.object === identifier && member.property.name === "View";
    }
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional
    )
      return false;
    const name = getStaticPropertyName(member);
    const use = member.parent;
    if (name === "Value") return isNodeOfType(use, "NewExpression") && use.callee === member;
    return (
      name !== null &&
      ANIMATION_METHODS.has(name) &&
      isNodeOfType(use, "CallExpression") &&
      use.callee === member &&
      !use.optional
    );
  });

const hasStandardProvidersAndArrayCalls = (
  animated: SymbolDescriptor,
  view: SymbolDescriptor,
  ref: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let closed = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!closed) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      node.type === "TSImportEqualsDeclaration"
    ) {
      closed = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration") && node.importKind !== "type") {
      const module = node.source.value;
      // Other runtime imports can provide a second route to replace a namespace.
      closed =
        (module === "react" || module === "react-native") &&
        node.specifiers.length > 0 &&
        node.specifiers.every((specifier) => {
          if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
          if (specifier.importKind === "type") return true;
          const name = getImportedName(specifier);
          if (!name || name === "default" || name.startsWith("__")) return false;
          if (module === "react") return name !== "useRef" || specifier === ref.declarationNode;
          if (name === "Animated") return specifier === animated.declarationNode;
          return name !== "View" || specifier === view.declarationNode;
        });
      return;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      node.source &&
      node.exportKind !== "type"
    ) {
      closed = false;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (property === "constructor" || property === "prototype" || property === "__proto__") {
        closed = false;
        return false;
      }
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      !POSSIBLE_INTRINSIC_ALIASES.has(node.name) ||
      !context.scopes.isGlobalReference(node)
    )
      return;
    const parent = findTransparentExpressionRoot(node).parent;
    closed =
      node.name === "Array" &&
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === findTransparentExpressionRoot(node) &&
      !parent.optional;
  });
  return closed;
};

const hasInertParameters = (parameters: EsTreeNode[]): boolean => {
  let inert = true;
  for (const parameter of parameters) {
    walkAst(parameter, (node) => {
      if (
        isNodeOfType(node, "AssignmentPattern") ||
        (isNodeOfType(node, "Property") && node.computed)
      ) {
        inert = false;
      }
      return inert;
    });
  }
  return inert;
};

const isFixedCount = (node: EsTreeNode | undefined, context: RuleContext): boolean => {
  if (!node) return false;
  const symbol = isNodeOfType(node, "Identifier") ? context.scopes.symbolFor(node) : null;
  const count =
    symbol && hasClosedReadOnlyReferences(symbol, context)
      ? getDirectConstInitializer(symbol)
      : node;
  return (
    isNodeOfType(count, "Literal") &&
    typeof count.value === "number" &&
    Number.isSafeInteger(count.value) &&
    count.value > 0
  );
};

const isFixedAnimationArray = (
  node: EsTreeNode,
  provider: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const initial = getMethodCall(node, "map");
  const filled = initial && getMethodCall(initial.receiver, "fill");
  if (
    !initial ||
    !filled ||
    initial.call.arguments.length !== 1 ||
    filled.call.arguments.length !== 1 ||
    !isZero(filled.call.arguments[0])
  )
    return false;
  const create = filled.receiver;
  if (
    !isNodeOfType(create, "CallExpression") ||
    create.optional ||
    create.arguments.length !== 1 ||
    !isNodeOfType(create.callee, "Identifier") ||
    create.callee.name !== "Array" ||
    !context.scopes.isGlobalReference(create.callee) ||
    !isFixedCount(create.arguments[0], context)
  )
    return false;
  const initializer = initial.call.arguments[0];
  if (
    !isNodeOfType(initializer, "ArrowFunctionExpression") ||
    initializer.async ||
    initializer.params.length !== 0
  )
    return false;
  const construct = stripParenExpression(initializer.body);
  return (
    isNodeOfType(construct, "NewExpression") &&
    construct.arguments.length === 1 &&
    isZero(construct.arguments[0]) &&
    isNodeOfType(construct.callee, "MemberExpression") &&
    !construct.callee.computed &&
    getStaticPropertyName(construct.callee) === "Value" &&
    isNodeOfType(construct.callee.object, "Identifier") &&
    context.scopes.symbolFor(construct.callee.object) === provider
  );
};

const isPrivateArrayRead = (identifier: EsTreeNode): boolean => {
  const member = identifier.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== identifier ||
    member.computed ||
    member.optional
  )
    return false;
  const name = getStaticPropertyName(member);
  const call = member.parent;
  if (
    name === null ||
    !ARRAY_READ_METHODS.has(name) ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== member ||
    call.optional ||
    call.arguments.length !== 1
  )
    return false;
  const callback = call.arguments[0];
  return (
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    callback.params.length <= 2 &&
    callback.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  );
};

export const hasFixedAnimatedSlotKeys = (
  key: EsTreeNodeOfType<"JSXAttribute">,
  iterator: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const map = getMethodCall(iterator, "map");
  const render = iterator.arguments[0];
  const opening = key.parent;
  if (
    !map ||
    !isNodeOfType(map.receiver, "Identifier") ||
    iterator.arguments.length !== 1 ||
    !isNodeOfType(render, "ArrowFunctionExpression") ||
    render.async ||
    render.params.length !== 2 ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !opening.selfClosing ||
    opening.parent !== stripParenExpression(render.body) ||
    !isNodeOfType(opening.name, "JSXMemberExpression") ||
    opening.name.property.name !== "View" ||
    !isNodeOfType(opening.name.object, "JSXIdentifier")
  )
    return false;
  const provider = getNamedRuntimeImport(opening.name.object, "react-native", "Animated", context);
  if (
    !provider ||
    opening.attributes.length !== 2 ||
    !opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === "style",
    )
  )
    return false;
  const index = render.params[1];
  const indexBinding = isNodeOfType(index, "Identifier") ? context.scopes.symbolFor(index) : null;
  if (
    !indexBinding ||
    !isNodeOfType(key.value, "JSXExpressionContainer") ||
    !isNodeOfType(key.value.expression, "Identifier") ||
    context.scopes.symbolFor(key.value.expression) !== indexBinding
  )
    return false;

  const children = findTransparentExpressionRoot(iterator).parent;
  const container = children?.parent;
  if (
    !isNodeOfType(children, "JSXExpressionContainer") ||
    !isNodeOfType(container, "JSXElement") ||
    !isNodeOfType(container.openingElement.name, "JSXIdentifier") ||
    container.openingElement.attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        attribute.name.name !== "style",
    )
  )
    return false;

  const view = getNamedRuntimeImport(
    container.openingElement.name,
    "react-native",
    "View",
    context,
  );
  if (
    !view ||
    !hasClosedReadOnlyReferences(view, context) ||
    !view.references.every(({ identifier }) => {
      const parent = identifier.parent;
      return (
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === identifier
      );
    })
  )
    return false;

  const rows = context.scopes.symbolFor(map.receiver);
  const storage = rows && getDirectConstInitializer(rows);
  const declarator = rows?.declarationNode;
  const declaration = declarator?.parent;
  const body = declaration?.parent;
  const component = body?.parent;
  // The ref occupies the component's first Hook slot on every render.
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations[0] !== declarator ||
    !isNodeOfType(body, "BlockStatement") ||
    body.body[0] !== declaration ||
    !isNodeOfType(component, "FunctionDeclaration") ||
    !component.id ||
    !/^[A-Z]/.test(component.id.name) ||
    !hasInertParameters(component.params)
  )
    return false;
  if (
    !rows ||
    !isNodeOfType(storage, "MemberExpression") ||
    storage.optional ||
    storage.computed ||
    getStaticPropertyName(storage) !== "current"
  )
    return false;
  const ref = storage.object;
  if (
    !isNodeOfType(ref, "CallExpression") ||
    ref.optional ||
    ref.arguments.length !== 1 ||
    !isNodeOfType(ref.callee, "Identifier")
  )
    return false;
  const refProvider = getNamedRuntimeImport(ref.callee, "react", "useRef", context);
  if (
    !refProvider ||
    !hasClosedReadOnlyReferences(refProvider, context) ||
    !refProvider.references.every(
      ({ identifier }) =>
        isNodeOfType(identifier.parent, "CallExpression") &&
        identifier.parent.callee === identifier &&
        !identifier.parent.optional,
    )
  )
    return false;

  // Reading the freshly created ref's current array directly leaves no ref
  // handle to replace it later. Iterators expose only individual slot values.
  return (
    hasClosedReadOnlyReferences(rows, context) &&
    rows.references.every(({ identifier }) => isPrivateArrayRead(identifier)) &&
    isFixedAnimationArray(ref.arguments[0], provider, context) &&
    hasClosedAnimatedProvider(provider, context) &&
    hasStandardProvidersAndArrayCalls(provider, view, refProvider, context)
  );
};
