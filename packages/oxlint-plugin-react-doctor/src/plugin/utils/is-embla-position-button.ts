import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getReactUseCallbackCall } from "./get-react-use-callback-call.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasStockViteEmblaProvider } from "./has-stock-vite-embla-provider.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";

const BUTTON_ATTRIBUTES = new Set(["key", "type", "aria-label", "className", "onClick"]);
const EMBLA_OPTIONS = new Set(["loop", "align", "slidesToScroll"]);
const EMBLA_DEPENDENCY_HOOKS = new Set(["useEffect", "useCallback"]);

const isClosedSymbol = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => isSymbolReadOnly(symbol) && hasCompleteSymbolReferences(symbol, program, scopes);

const isSameBinding = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;

const getDirectMemberCall = (
  expression: EsTreeNode | null | undefined,
  method: string,
): EsTreeNodeOfType<"CallExpression"> | null =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  isNodeOfType(expression.callee, "MemberExpression") &&
  !expression.callee.optional &&
  !expression.callee.computed &&
  getStaticPropertyName(expression.callee) === method
    ? expression
    : null;

const getCallReceiver = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null =>
  isNodeOfType(call.callee, "MemberExpression") && isNodeOfType(call.callee.object, "Identifier")
    ? scopes.symbolFor(call.callee.object)
    : null;

const getStateWrite = (
  stateNode: EsTreeNode,
  initialState: "empty-array" | "number",
  owner: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const state = scopes.symbolFor(stateNode);
  const declaration = state?.declarationNode;
  if (
    !state ||
    state.kind !== "const" ||
    !isClosedSymbol(state, program, scopes) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    findEnclosingFunction(declaration) !== owner ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    declaration.id.elements[0] !== state.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isReactApiCall(declaration.init, "useState", scopes, { resolveNamedAliases: true })
  ) {
    return null;
  }
  const [initial] = declaration.init.arguments;
  if (
    declaration.init.arguments.length !== 1 ||
    (initialState === "empty-array"
      ? !isNodeOfType(initial, "ArrayExpression") || initial.elements.length !== 0
      : !isNodeOfType(initial, "Literal") || typeof initial.value !== "number")
  )
    return null;
  const setterNode = declaration.id.elements[1];
  if (!isNodeOfType(setterNode, "Identifier")) return null;
  const setter = scopes.symbolFor(setterNode);
  if (!setter || setter.references.length !== 1 || !isClosedSymbol(setter, program, scopes)) {
    return null;
  }
  const [use] = setter.references;
  if (!use) return null;
  const write = use.identifier.parent;
  return isNodeOfType(write, "CallExpression") &&
    write.callee === use.identifier &&
    !write.optional &&
    write.arguments.length === 1
    ? write
    : null;
};

const isStockEmblaHandle = (
  api: SymbolDescriptor,
  owner: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const binding = api.declarationNode;
  if (
    api.kind !== "const" ||
    !isClosedSymbol(api, program, scopes) ||
    !isNodeOfType(binding, "VariableDeclarator") ||
    findEnclosingFunction(binding) !== owner ||
    !isNodeOfType(binding.id, "ArrayPattern") ||
    binding.id.elements.length !== 2 ||
    binding.id.elements[1] !== api.bindingIdentifier ||
    !isNodeOfType(binding.init, "CallExpression") ||
    binding.init.optional
  ) {
    return false;
  }
  const hook = resolveImportedApiReference(binding.init.callee, scopes);
  const [options, plugins] = binding.init.arguments;
  return (
    hook?.source === "embla-carousel-react" &&
    hook.importedName === "default" &&
    binding.init.arguments.length === 2 &&
    isNodeOfType(plugins, "ArrayExpression") &&
    plugins.elements.length === 0 &&
    isNodeOfType(options, "ObjectExpression") &&
    options.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.computed &&
        !property.method &&
        EMBLA_OPTIONS.has(getStaticPropertyKeyName(property) ?? "") &&
        (isNodeOfType(property.value, "Literal") ||
          (isNodeOfType(property.value, "ConditionalExpression") &&
            isNodeOfType(property.value.test, "Identifier") &&
            isNodeOfType(property.value.consequent, "Literal") &&
            isNodeOfType(property.value.alternate, "Literal"))),
    )
  );
};

const getJsxValue = (opening: EsTreeNodeOfType<"JSXOpeningElement">, name: string) => {
  const value = getAuthoritativeJsxAttribute(opening.attributes, name)?.value;
  return isNodeOfType(value, "JSXExpressionContainer") ? value.expression : null;
};

const hasOnlyHandleDependency = (
  hookCall: EsTreeNodeOfType<"CallExpression">,
  api: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const dependencies = hookCall.arguments[1];
  return (
    hookCall.arguments.length === 2 &&
    isNodeOfType(dependencies, "ArrayExpression") &&
    dependencies.elements.length === 1 &&
    isSameBinding(dependencies.elements[0], api, scopes)
  );
};

const getOrdinalScrollCall = (
  click: EsTreeNode | null,
  index: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isNodeOfType(click, "ArrowFunctionExpression") || click.async || click.params.length !== 0) {
    return null;
  }
  const forward = click.body;
  if (
    !isNodeOfType(forward, "CallExpression") ||
    forward.optional ||
    !isNodeOfType(forward.callee, "Identifier") ||
    forward.arguments.length !== 1 ||
    !isSameBinding(forward.arguments[0], index, scopes)
  ) {
    return null;
  }
  const forwarder = scopes.symbolFor(forward.callee);
  if (
    !forwarder ||
    forwarder.references.length !== 1 ||
    !isClosedSymbol(forwarder, program, scopes)
  ) {
    return null;
  }
  const memo = getReactUseCallbackCall(forward.callee, scopes);
  if (!memo) return null;
  const callback = memo.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1
  ) {
    return null;
  }
  const guard = callback.body.body[0];
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "ExpressionStatement")
  ) {
    return null;
  }
  const scroll = getDirectMemberCall(guard.consequent.expression, "scrollTo");
  const api = scroll && getCallReceiver(scroll, scopes);
  const position = scopes.symbolFor(callback.params[0]);
  return scroll &&
    api &&
    position &&
    scroll.arguments.length === 1 &&
    hasOnlyHandleDependency(memo, api, scopes) &&
    isSameBinding(guard.test, api, scopes) &&
    isSameBinding(scroll.arguments[0], position, scopes)
    ? scroll
    : null;
};

const getSelectionRead = (
  expression: EsTreeNode | null,
  index: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(expression, "TemplateLiteral") || expression.expressions.length !== 1) {
    return null;
  }
  const [part] = expression.expressions;
  if (
    !isNodeOfType(part, "ConditionalExpression") ||
    !isNodeOfType(part.consequent, "Literal") ||
    typeof part.consequent.value !== "string" ||
    !isNodeOfType(part.alternate, "Literal") ||
    typeof part.alternate.value !== "string" ||
    !isNodeOfType(part.test, "BinaryExpression") ||
    part.test.operator !== "===" ||
    !isSameBinding(part.test.left, index, scopes) ||
    !isNodeOfType(part.test.right, "Identifier")
  ) {
    return null;
  }
  return part.test.right;
};

const readsOnlyOrdinal = (
  label: EsTreeNode | null,
  index: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(label, "TemplateLiteral") &&
  label.expressions.length === 1 &&
  label.expressions.every(
    (part) =>
      isNodeOfType(part, "BinaryExpression") &&
      part.operator === "+" &&
      isSameBinding(part.left, index, scopes) &&
      isNodeOfType(part.right, "Literal") &&
      part.right.value === 1,
  );

const isSelectionListener = (
  listener: EsTreeNode,
  selectionWrite: EsTreeNodeOfType<"CallExpression">,
  api: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(listener, "Identifier")) return false;
  const binding = scopes.symbolFor(listener);
  const memo = getReactUseCallbackCall(listener, scopes);
  if (memo && !hasOnlyHandleDependency(memo, api, scopes)) return false;
  const callback = memo?.arguments[0] ?? binding?.initializer;
  if (
    binding?.kind !== "const" ||
    !isSymbolReadOnly(binding) ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0
  ) {
    return false;
  }
  if (callback.body === selectionWrite) return true;
  if (!isNodeOfType(callback.body, "BlockStatement") || callback.body.body.length !== 2)
    return false;
  const [guard, update] = callback.body.body;
  return (
    isNodeOfType(guard, "IfStatement") &&
    !guard.alternate &&
    isNodeOfType(guard.test, "UnaryExpression") &&
    guard.test.operator === "!" &&
    isSameBinding(guard.test.argument, api, scopes) &&
    isNodeOfType(guard.consequent, "ReturnStatement") &&
    !guard.consequent.argument &&
    isNodeOfType(update, "ExpressionStatement") &&
    update.expression === selectionWrite
  );
};

const hasClosedEmblaApiUses = (
  api: SymbolDescriptor,
  scroll: EsTreeNodeOfType<"CallExpression">,
  snaps: EsTreeNodeOfType<"CallExpression">,
  selection: EsTreeNodeOfType<"CallExpression">,
  selectionWrite: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean =>
  api.references.every(({ identifier }) => {
    const parent = identifier.parent;
    if (isNodeOfType(parent, "IfStatement")) return parent.test === identifier;
    if (isNodeOfType(parent, "UnaryExpression")) {
      return (
        parent.operator === "!" &&
        isNodeOfType(parent.parent, "IfStatement") &&
        parent.parent.test === parent
      );
    }
    if (isNodeOfType(parent, "ArrayExpression")) {
      const hookCall = parent.parent;
      return (
        isNodeOfType(hookCall, "CallExpression") &&
        hookCall.arguments[1] === parent &&
        isReactApiCall(hookCall, EMBLA_DEPENDENCY_HOOKS, scopes)
      );
    }
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== identifier ||
      parent.computed
    ) {
      return false;
    }
    const call = parent.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== parent) return false;
    if (call === scroll || call === snaps || call === selection) return true;
    if (!isNodeOfType(findTransparentExpressionRoot(call).parent, "ExpressionStatement"))
      return false;
    const method = getStaticPropertyName(parent);
    if (method === "scrollPrev" || method === "scrollNext") return call.arguments.length === 0;
    if ((method !== "on" && method !== "off") || call.arguments.length !== 2) return false;
    const [event, listener] = call.arguments;
    return (
      isNodeOfType(event, "Literal") &&
      (event.value === "select" || event.value === "reInit") &&
      Boolean(listener && isSelectionListener(listener, selectionWrite, api, scopes))
    );
  });

const isDirectNativeOutput = (
  map: EsTreeNodeOfType<"CallExpression">,
  owner: EsTreeNode,
  explicitButtonType: boolean,
): boolean => {
  const container = findTransparentExpressionRoot(map).parent;
  if (!isNodeOfType(container, "JSXExpressionContainer")) return false;
  let child: EsTreeNode = container;
  let enclosing = child.parent;
  while (isNodeOfType(enclosing, "JSXElement") || isNodeOfType(enclosing, "JSXFragment")) {
    if (!enclosing.children.some((item) => item === child)) return false;
    if (isNodeOfType(enclosing, "JSXElement")) {
      const tag = enclosing.openingElement.name;
      if (
        !isNodeOfType(tag, "JSXIdentifier") ||
        !HTML_TAGS.has(tag.name) ||
        (tag.name === "form" && !explicitButtonType)
      )
        return false;
    }
    child = enclosing;
    enclosing = enclosing.parent;
  }
  const returned = findTransparentExpressionRoot(child);
  const parent = returned.parent;
  return (
    (isNodeOfType(parent, "ReturnStatement") &&
      parent.argument === returned &&
      findEnclosingFunction(parent) === owner) ||
    (isNodeOfType(owner, "ArrowFunctionExpression") && owner.body === returned)
  );
};

export const isEmblaPositionButton = (
  key: EsTreeNodeOfType<"JSXAttribute">,
  mapCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const opening = key.parent;
  const map = getDirectMemberCall(mapCall, "map");
  if (
    !map ||
    !isNodeOfType(map.callee, "MemberExpression") ||
    !isNodeOfType(map.callee.object, "Identifier") ||
    map.arguments.length !== 1 ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !opening.selfClosing ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "button"
  )
    return false;
  const callback = map.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 2 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.params[1], "Identifier") ||
    callback.body !== opening.parent
  )
    return false;
  const item = scopes.symbolFor(callback.params[0]);
  const index = scopes.symbolFor(callback.params[1]);
  const program = findProgramRoot(map);
  const owner = findEnclosingFunction(map);
  if (
    !item ||
    item.references.length !== 0 ||
    !index ||
    !program ||
    !owner ||
    !isClosedSymbol(item, program, scopes) ||
    !isClosedSymbol(index, program, scopes) ||
    !isSameBinding(getJsxValue(opening, "key"), index, scopes)
  )
    return false;
  const attributeNames = new Set<string>();
  for (const attribute of opening.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      !BUTTON_ATTRIBUTES.has(attribute.name.name) ||
      attributeNames.has(attribute.name.name) ||
      (attribute.name.name === "type" &&
        (!isNodeOfType(attribute.value, "Literal") || attribute.value.value !== "button"))
    )
      return false;
    attributeNames.add(attribute.name.name);
  }
  if (
    !isDirectNativeOutput(map, owner, attributeNames.has("type")) ||
    !readsOnlyOrdinal(getJsxValue(opening, "aria-label"), index, scopes)
  )
    return false;
  const readSelected = getSelectionRead(getJsxValue(opening, "className"), index, scopes);
  const scroll = getOrdinalScrollCall(getJsxValue(opening, "onClick"), index, program, scopes);
  if (!scroll || !readSelected) return false;
  const api = getCallReceiver(scroll, scopes);
  const snapState = scopes.symbolFor(map.callee.object);
  if (
    !snapState ||
    snapState.references.length !== 1 ||
    snapState.references[0]?.identifier !== map.callee.object
  )
    return false;
  const snapWrite = getStateWrite(map.callee.object, "empty-array", owner, program, scopes);
  const selectionWrite = getStateWrite(readSelected, "number", owner, program, scopes);
  const snaps = getDirectMemberCall(snapWrite?.arguments[0], "scrollSnapList");
  const selection = getDirectMemberCall(selectionWrite?.arguments[0], "selectedScrollSnap");
  return Boolean(
    api &&
    snaps &&
    selection &&
    selectionWrite &&
    snaps.arguments.length === 0 &&
    selection.arguments.length === 0 &&
    getCallReceiver(snaps, scopes) === api &&
    getCallReceiver(selection, scopes) === api &&
    isStockEmblaHandle(api, owner, program, scopes) &&
    hasClosedEmblaApiUses(api, scroll, snaps, selection, selectionWrite, scopes) &&
    hasStockViteEmblaProvider(context, program),
  );
};
