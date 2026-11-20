import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const MAP_OPTIONS = new Set([
  "container",
  "style",
  "center",
  "zoom",
  "maxTileCacheSize",
  "refreshExpiredTiles",
]);
const RASTER_SOURCE_OPTIONS = new Set(["type", "tiles", "tileSize"]);
const RASTER_LAYER_OPTIONS = new Set(["id", "type", "source", "paint"]);
const STANDALONE_MAP_METHODS = new Set(["flyTo", "removeLayer", "removeSource"]);

const isString = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "string";

const isLiteral = (node: EsTreeNode | undefined, value: string | null): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;

const isPlainOptions = (
  node: EsTreeNode | undefined,
  names: ReadonlySet<string>,
  raster = false,
): boolean => {
  if (!isNodeOfType(node, "ObjectExpression")) return false;
  let hasRasterType = false;
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (name === null || !names.has(name)) return false;
    if (name === "style" && !isString(property.value)) return false;
    if (name === "type") {
      if (!isLiteral(property.value, "raster")) return false;
      hasRasterType = true;
    }
  }
  return !raster || hasRasterType;
};

const hasClosedReferences = (symbol: SymbolDescriptor, context: RuleContext): boolean =>
  isSymbolReadOnly(symbol) &&
  hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes);

const isDirectConstructor = (
  node: EsTreeNode | undefined,
  provider: SymbolDescriptor,
  name: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "NewExpression") || !isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }
  const { object, property, computed } = node.callee;
  return (
    !computed &&
    isNodeOfType(property, "Identifier") &&
    property.name === name &&
    isNodeOfType(object, "Identifier") &&
    context.scopes.symbolFor(object) === provider
  );
};

const isStockMapCall = (
  receiver: EsTreeNode,
  provider: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier")
  )
    return false;
  const call = member.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== member || call.optional)
    return false;
  const name = member.property.name;
  const [first, second] = call.arguments;
  const resultUse = call.parent;
  if (name === "getCenter" || name === "getZoom") return call.arguments.length === 0;
  if (name === "getSource") {
    // The source object retains the map. Only its presence may be observed.
    return (
      call.arguments.length === 1 &&
      isString(first) &&
      ((isNodeOfType(resultUse, "IfStatement") && resultUse.test === call) ||
        (isNodeOfType(resultUse, "UnaryExpression") && resultUse.operator === "!"))
    );
  }
  // Map methods often return the receiver for chaining.
  if (!isNodeOfType(resultUse, "ExpressionStatement")) return false;
  if (name === "addControl") {
    return (
      isNodeOfType(first, "NewExpression") &&
      first.arguments.length === 0 &&
      isDirectConstructor(first, provider, "NavigationControl", context) &&
      (call.arguments.length === 1 || (call.arguments.length === 2 && isString(second)))
    );
  }
  if (name === "addSource") {
    return (
      call.arguments.length === 2 &&
      isString(first) &&
      isPlainOptions(second, RASTER_SOURCE_OPTIONS, true)
    );
  }
  if (name === "addLayer") {
    return call.arguments.length === 1 && isPlainOptions(first, RASTER_LAYER_OPTIONS, true);
  }
  return STANDALONE_MAP_METHODS.has(name);
};

const isClosedLocalMapHelperCall = (
  receiver: EsTreeNode,
  provider: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const call = receiver.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments[0] !== receiver ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(call.callee);
  const helper = symbol?.declarationNode;
  if (
    !symbol ||
    !isNodeOfType(helper, "FunctionDeclaration") ||
    helper.async ||
    helper.generator ||
    !isNodeOfType(helper.parent, "Program") ||
    !hasClosedReferences(symbol, context)
  )
    return false;
  const parameter = helper.params[0];
  const parameterSymbol = isNodeOfType(parameter, "Identifier")
    ? context.scopes.symbolFor(parameter)
    : null;
  return (
    parameterSymbol !== null &&
    hasClosedReferences(parameterSymbol, context) &&
    parameterSymbol.references.every(({ identifier }) =>
      isStockMapCall(identifier, provider, context),
    )
  );
};

const isOwnMapRead = (
  receiver: EsTreeNode,
  provider: SymbolDescriptor,
  context: RuleContext,
): boolean =>
  isStockMapCall(receiver, provider, context) ||
  isClosedLocalMapHelperCall(receiver, provider, context) ||
  (isNodeOfType(receiver.parent, "UnaryExpression") && receiver.parent.operator === "!") ||
  (isNodeOfType(receiver.parent, "LogicalExpression") &&
    receiver.parent.operator === "&&" &&
    receiver.parent.left === receiver &&
    isNodeOfType(receiver.parent.parent, "IfStatement") &&
    receiver.parent.parent.test === receiver.parent);

const isPrivateMapRefStore = (
  write: EsTreeNode,
  map: SymbolDescriptor,
  provider: SymbolDescriptor,
  cleanup: EsTreeNodeOfType<"ArrowFunctionExpression" | "FunctionExpression">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    !isNodeOfType(write.parent, "ExpressionStatement") ||
    !isNodeOfType(write.left, "MemberExpression") ||
    write.left.computed ||
    !isNodeOfType(write.left.property, "Identifier") ||
    write.left.property.name !== "current" ||
    !isNodeOfType(write.left.object, "Identifier")
  )
    return false;
  const ref = context.scopes.symbolFor(write.left.object);
  const init = ref ? getDirectConstInitializer(ref) : null;
  if (
    !ref ||
    !isNodeOfType(init, "CallExpression") ||
    !isReactApiCall(init, "useRef", context.scopes) ||
    init.arguments.length !== 1 ||
    !isLiteral(init.arguments[0], null) ||
    !hasClosedReferences(ref, context)
  )
    return false;

  let didResetRef = false;
  const closed = ref.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      member.property.name !== "current"
    )
      return false;
    const use = member.parent;
    if (use === write && write.left === member) return true;
    if (isNodeOfType(use, "AssignmentExpression")) {
      const body = cleanup.body;
      if (
        use.operator !== "=" ||
        use.left !== member ||
        !isLiteral(use.right, null) ||
        !isNodeOfType(body, "BlockStatement") ||
        body.body[1] !== use.parent ||
        didResetRef
      )
        return false;
      didResetRef = true;
      return true;
    }
    if (
      !isNodeOfType(use, "VariableDeclarator") ||
      use.init !== member ||
      !isNodeOfType(use.id, "Identifier")
    )
      return false;
    const read = context.scopes.symbolFor(use.id);
    return (
      read !== null &&
      read !== map &&
      getDirectConstInitializer(read) === member &&
      hasClosedReferences(read, context) &&
      read.references.every(({ identifier: useOfRead }) =>
        isOwnMapRead(useOfRead, provider, context),
      )
    );
  });
  return closed && didResetRef;
};

const isClosedStockProvider = (provider: SymbolDescriptor, context: RuleContext): boolean => {
  const declaration = getImportDeclarationForSymbol(provider);
  if (
    !isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
    declaration?.source.value !== "mapbox-gl" ||
    declaration.importKind === "type" ||
    declaration.specifiers.length !== 1 ||
    !hasClosedReferences(provider, context)
  )
    return false;
  return provider.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (isNodeOfType(member, "TSQualifiedName")) return true;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier")
    )
      return false;
    const use = member.parent;
    if (isNodeOfType(use, "NewExpression") && use.callee === member) {
      return (
        (member.property.name === "Map" &&
          use.arguments.length === 1 &&
          isPlainOptions(use.arguments[0], MAP_OPTIONS)) ||
        (member.property.name === "NavigationControl" && use.arguments.length === 0)
      );
    }
    return (
      member.property.name === "accessToken" &&
      isNodeOfType(use, "AssignmentExpression") &&
      use.operator === "=" &&
      use.left === member
    );
  });
};

// Map.remove() stops the render that delivers the initial load event. The
// receiver must remain private because Evented still supports explicit fire().
export const hasDisposedMapboxLoadListener = (
  effect: EsTreeNode,
  registration: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(registration, "CallExpression") ||
    registration.optional ||
    registration.arguments.length !== 2 ||
    !isLiteral(registration.arguments[0], "load") ||
    !isNodeOfType(registration.arguments[1], "ArrowFunctionExpression") ||
    registration.arguments[1].params.length !== 0 ||
    registration.arguments[1].async ||
    !isNodeOfType(registration.callee, "MemberExpression") ||
    registration.callee.computed ||
    registration.callee.optional ||
    !isNodeOfType(registration.callee.object, "Identifier")
  ) {
    return false;
  }
  const receiver = registration.callee.object;
  const map = context.scopes.symbolFor(receiver);
  const init = map ? getDirectConstInitializer(map) : null;
  if (
    !map ||
    !isNodeOfType(init, "NewExpression") ||
    init.arguments.length !== 1 ||
    !isPlainOptions(init.arguments[0], MAP_OPTIONS) ||
    !isNodeOfType(init.callee, "MemberExpression") ||
    !isNodeOfType(init.callee.object, "Identifier")
  )
    return false;
  const provider = context.scopes.symbolFor(init.callee.object);
  if (!provider || !isDirectConstructor(init, provider, "Map", context)) return false;

  const registrationStatement = registration.parent;
  const effectBody = registrationStatement?.parent;
  if (
    !isNodeOfType(registrationStatement, "ExpressionStatement") ||
    !isNodeOfType(effectBody, "BlockStatement") ||
    effectBody.parent !== effect ||
    map.declarationNode.parent?.parent !== effectBody ||
    effectBody.body.at(-2) !== registrationStatement
  )
    return false;
  const terminal = effectBody.body.at(-1);
  const cleanup = isNodeOfType(terminal, "ReturnStatement") ? terminal.argument : null;
  if (
    (!isNodeOfType(cleanup, "ArrowFunctionExpression") &&
      !isNodeOfType(cleanup, "FunctionExpression")) ||
    cleanup.async ||
    ("generator" in cleanup && cleanup.generator) ||
    cleanup.params.length !== 0
  )
    return false;
  const firstCleanupStatement = isNodeOfType(cleanup.body, "BlockStatement")
    ? cleanup.body.body[0]
    : null;
  const remove = isNodeOfType(cleanup.body, "BlockStatement")
    ? isNodeOfType(firstCleanupStatement, "ExpressionStatement")
      ? firstCleanupStatement.expression
      : null
    : cleanup.body;
  if (
    !isNodeOfType(remove, "CallExpression") ||
    remove.optional ||
    remove.arguments.length !== 0 ||
    !isNodeOfType(remove.callee, "MemberExpression") ||
    remove.callee.computed ||
    remove.callee.optional ||
    !isNodeOfType(remove.callee.property, "Identifier") ||
    remove.callee.property.name !== "remove" ||
    !isNodeOfType(remove.callee.object, "Identifier") ||
    context.scopes.symbolFor(remove.callee.object) !== map
  )
    return false;

  if (!hasClosedReferences(map, context) || !isClosedStockProvider(provider, context)) return false;
  const providerImport = getImportDeclarationForSymbol(provider);
  let hasUncertainProvider = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasUncertainProvider) return false;
    const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
    hasUncertainProvider =
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node !== providerImport &&
        node.importKind !== "type" &&
        node.source.value === "mapbox-gl") ||
      (isNodeOfType(node, "ImportExpression") && isLiteral(node.source, "mapbox-gl")) ||
      (isNodeOfType(node, "CallExpression") &&
        isNodeOfType(callee, "Identifier") &&
        (callee.name === "eval" ||
          (callee.name === "require" && isLiteral(node.arguments[0], "mapbox-gl"))));
  });
  if (hasUncertainProvider) return false;

  const removedReceiver = remove.callee.object;
  return map.references.every(({ identifier }) => {
    if (identifier === receiver || identifier === removedReceiver) return true;
    const use = identifier.parent;
    if (isNodeOfType(use, "AssignmentExpression") && use.right === identifier) {
      return (
        use.parent?.parent === effectBody &&
        isPrivateMapRefStore(use, map, provider, cleanup, context)
      );
    }
    return isOwnMapRead(identifier, provider, context);
  });
};
