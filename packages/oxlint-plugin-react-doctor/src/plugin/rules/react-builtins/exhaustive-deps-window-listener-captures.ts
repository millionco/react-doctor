import { closureCaptures } from "../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isOutsideAllFunctions, unwrapExpression } from "./exhaustive-deps-low-level.js";
import { symbolHasStableHookOrigin } from "./exhaustive-deps-symbol-stability.js";

type ListenerMethod = "addEventListener" | "removeEventListener";
interface ListenerSite {
  readonly event: string;
  readonly argument: EsTreeNodeOfType<"Identifier">;
  readonly binding: SymbolDescriptor;
}

const readWindowListener = (
  expression: EsTreeNode,
  method: ListenerMethod,
  scopes: ScopeAnalysis,
): ListenerSite | null => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 2 ||
    !isNodeOfType(expression.callee, "MemberExpression")
  )
    return null;
  const callee = expression.callee;
  const [event, argument] = expression.arguments;
  if (
    callee.optional ||
    callee.computed ||
    getStaticPropertyName(callee) !== method ||
    !isNodeOfType(callee.object, "Identifier") ||
    callee.object.name !== "window" ||
    !scopes.isGlobalReference(callee.object) ||
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(argument, "Identifier")
  )
    return null;
  const binding = scopes.symbolFor(argument);
  return binding ? { event: event.value, argument, binding } : null;
};

const readListenerStatements = (
  statements: readonly EsTreeNode[],
  method: ListenerMethod,
  scopes: ScopeAnalysis,
): ListenerSite[] | null => {
  const sites: ListenerSite[] = [];
  for (const statement of statements) {
    if (!isNodeOfType(statement, "ExpressionStatement")) return null;
    const site = readWindowListener(statement.expression, method, scopes);
    if (!site) return null;
    sites.push(site);
  }
  return sites;
};

const AMBIENT_LISTENER_ALIASES = new Set([
  "globalThis",
  "global",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "Window",
  "EventTarget",
  "Document",
  "Element",
  "HTMLElement",
  "Node",
  "frameElement",
  "addEventListener",
  "removeEventListener",
  "Function",
  "require",
  "module",
  "eval",
]);

const STRING_CAPABLE_TIMER_NAMES = new Set(["setTimeout", "setInterval"]);
const DOM_WINDOW_CAPABILITY_PROPERTIES = new Set([
  "currentTarget",
  "defaultView",
  "ownerDocument",
  "contentWindow",
]);

const isDirectNamedReactHookCall = (
  node: EsTreeNode,
  hook: "useEffect" | "useRef" | "useState",
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  ) {
    return false;
  }
  const binding = scopes.symbolFor(node.callee);
  const specifier = binding?.declarationNode;
  const declaration = specifier?.parent;
  return (
    binding?.kind === "import" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "react" &&
    getImportedName(specifier) === hook
  );
};

const closedWindowReceiversByScope = new WeakMap<ScopeAnalysis, boolean>();

const usesStockWindowListenerShape = (scopes: ScopeAnalysis): boolean => {
  const cached = closedWindowReceiversByScope.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed) return false;
    if (isNodeOfType(node, "ThisExpression") || isNodeOfType(node, "ImportExpression")) {
      closed = false;
      return false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === "react" &&
      node.importKind !== "type" &&
      node.specifiers.some(
        (specifier) =>
          !isNodeOfType(specifier, "ImportSpecifier") ||
          (specifier.importKind !== "type" && getImportedName(specifier) === "default"),
      )
    ) {
      closed = false;
      return false;
    }
    // A local DOM or listener reference can reveal the same Window even without
    // mentioning an ambient Window binding. Keep those visible routes outside the proof.
    const capabilityProperty = isNodeOfType(node, "MemberExpression")
      ? getStaticPropertyName(node)
      : isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")
        ? getStaticPropertyKeyName(node)
        : null;
    if (capabilityProperty != null && DOM_WINDOW_CAPABILITY_PROPERTIES.has(capabilityProperty)) {
      closed = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (STRING_CAPABLE_TIMER_NAMES.has(node.name)) {
      const target = findTransparentExpressionRoot(node);
      const call = target.parent;
      if (
        isNodeOfType(call, "CallExpression") &&
        !call.optional &&
        call.callee === target &&
        isNodeOfType(call.arguments[0], "ArrowFunctionExpression")
      )
        return;
      closed = false;
      return false;
    }
    if (AMBIENT_LISTENER_ALIASES.has(node.name)) {
      closed = false;
      return false;
    }
    if (node.name !== "window" && node.name !== "document") return;
    const receiver = findTransparentExpressionRoot(node);
    const member = receiver.parent;
    if (isNodeOfType(member, "UnaryExpression") && member.operator === "typeof") return;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== receiver) {
      closed = false;
      return false;
    }
    const name = getStaticPropertyName(member);
    const access = findTransparentExpressionRoot(member);
    const consumer = access.parent;
    // An active element exposes its document and window through the DOM. Only allow
    // identity comparison here, where that value cannot escape to a custom method.
    if (
      node.name === "document" &&
      name === "activeElement" &&
      isNodeOfType(consumer, "BinaryExpression") &&
      (consumer.operator === "===" || consumer.operator === "!==")
    )
      return;
    if (
      node.name === "window" &&
      (name === "addEventListener" || name === "removeEventListener") &&
      isNodeOfType(consumer, "CallExpression") &&
      consumer.callee === access
    )
      return;
    closed = false;
    return false;
  });
  closedWindowReceiversByScope.set(scopes, closed);
  return closed;
};

const hasUntrackedListenerClosureSyntax = (fn: EsTreeNode): boolean => {
  let found = false;
  walkAst(fn, (node) => {
    if (node === fn || found) return found ? false : undefined;
    if (
      isFunctionLike(node) ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super") ||
      isNodeOfType(node, "MetaProperty") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const directBodyIndex = (statement: EsTreeNode, owner: EsTreeNode): number =>
  isFunctionLike(owner) && isNodeOfType(owner.body, "BlockStatement")
    ? owner.body.body.findIndex((child) => child === statement)
    : -1;

const isInitializedBeforeEffect = (
  binding: SymbolDescriptor,
  owner: EsTreeNode,
  effectIndex: number,
): boolean => {
  const declaration = binding.declarationNode;
  if (binding.kind !== "const" || !isNodeOfType(declaration, "VariableDeclarator")) return false;
  const statement = declaration.parent;
  if (!isNodeOfType(statement, "VariableDeclaration")) return false;
  const index = directBodyIndex(statement, owner);
  return index >= 0 && index < effectIndex;
};

const isDirectCallTarget = (identifier: EsTreeNode): boolean => {
  const target = findTransparentExpressionRoot(identifier);
  const call = target.parent;
  return isNodeOfType(call, "CallExpression") && !call.optional && call.callee === target;
};

const isStableListenerValue = (binding: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const declaration = binding.declarationNode;
  if (!isNodeOfType(declaration, "VariableDeclarator") || !declaration.init) return false;
  const value = unwrapExpression(declaration.init);
  if (!isNodeOfType(value, "CallExpression")) {
    return (
      declaration.id === binding.bindingIdentifier && symbolHasStableHookOrigin(binding, scopes)
    );
  }
  if (value.optional) return false;
  if (declaration.id === binding.bindingIdentifier) {
    return isDirectNamedReactHookCall(value, "useRef", scopes);
  }
  return (
    isNodeOfType(declaration.id, "ArrayPattern") &&
    declaration.id.elements.length === 2 &&
    isNodeOfType(declaration.id.elements[1], "Identifier") &&
    declaration.id.elements[1] === binding.bindingIdentifier &&
    isDirectNamedReactHookCall(value, "useState", scopes)
  );
};

const collectCoveredListenerKeys = (
  listener: EsTreeNode,
  owner: EsTreeNode,
  effectIndex: number,
  declaredBindings: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): ReadonlySet<string> | null => {
  const keys = new Set<string>();
  const analyzed = new Map<EsTreeNode, boolean>();
  const coversFunction = (fn: EsTreeNode): boolean => {
    const cached = analyzed.get(fn);
    if (cached !== undefined) return cached;
    // Keep opaque nested callbacks and recursive local helper graphs outside the proof.
    analyzed.set(fn, false);
    if (hasUntrackedListenerClosureSyntax(fn)) return false;
    for (const capture of closureCaptures(fn, scopes)) {
      const binding = capture.resolvedSymbol;
      if (!binding) continue;
      if (capture.flag !== "read") return false;
      if (isOutsideAllFunctions(binding)) continue;
      if (
        findEnclosingFunction(binding.bindingIdentifier) !== owner ||
        !isSymbolReadOnly(binding)
      ) {
        return false;
      }
      if (declaredBindings.has(binding)) {
        keys.add(binding.name);
        continue;
      }
      if (!isInitializedBeforeEffect(binding, owner, effectIndex)) return false;
      const localFunction = getDirectConstInitializer(binding);
      if (isFunctionLike(localFunction)) {
        if (
          !isNodeOfType(localFunction, "ArrowFunctionExpression") ||
          localFunction.async ||
          !binding.references.every(({ identifier }) => isDirectCallTarget(identifier)) ||
          !hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) ||
          !coversFunction(localFunction)
        )
          return false;
        continue;
      }
      if (!isStableListenerValue(binding, scopes)) return false;
    }
    analyzed.set(fn, true);
    return true;
  };
  return coversFunction(listener) && keys.size > 0 ? keys : null;
};

// For an effect whose entire setup and teardown are matching native listener
// operations, replaying the registration on unrelated renders is unnecessary
// when the listener's own render captures already occur in the deps array.
export const getCoveredWindowListenerCaptures = (
  callback: EsTreeNode,
  deps: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): ReadonlyMap<SymbolDescriptor, ReadonlySet<string>> | undefined => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length < 2
  )
    return undefined;
  const setup = readListenerStatements(callback.body.body.slice(0, -1), "addEventListener", scopes);
  if (!setup) return undefined;
  const teardown = callback.body.body.at(-1);
  if (!isNodeOfType(teardown, "ReturnStatement")) return undefined;
  const cleanup = teardown.argument;
  if (
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    cleanup.params.length !== 0
  ) {
    return undefined;
  }
  const body = cleanup.body;
  const last = isNodeOfType(body, "BlockStatement")
    ? readListenerStatements(body.body, "removeEventListener", scopes)
    : [readWindowListener(body, "removeEventListener", scopes)];
  if (last?.length !== setup.length || !usesStockWindowListenerShape(scopes)) return undefined;
  for (const [index, site] of setup.entries()) {
    const release = last[index];
    if (release?.binding !== site.binding || release.event !== site.event) return undefined;
  }
  const owner = findEnclosingFunction(callback);
  const effect = findTransparentExpressionRoot(callback).parent;
  const statement = effect?.parent;
  if (
    !owner ||
    !isNodeOfType(effect, "CallExpression") ||
    !isDirectNamedReactHookCall(effect, "useEffect", scopes) ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== effect
  )
    return undefined;
  const effectIndex = directBodyIndex(statement, owner);
  if (effectIndex < 0) return undefined;
  const declaredBindings = new Set<SymbolDescriptor>();
  for (const element of deps.elements) {
    if (!isNodeOfType(element, "Identifier")) return undefined;
    const binding = scopes.symbolFor(element);
    if (!binding) return undefined;
    declaredBindings.add(binding);
  }
  const overrides = new Map<SymbolDescriptor, ReadonlySet<string>>();
  for (const [index, site] of setup.entries()) {
    const binding = site.binding;
    const released = last[index]?.argument;
    if (
      declaredBindings.has(binding) ||
      !isInitializedBeforeEffect(binding, owner, effectIndex) ||
      binding.references.length !== 2 ||
      !binding.references.every(
        ({ identifier, flag }) =>
          flag === "read" && (identifier === site.argument || identifier === released),
      ) ||
      !hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes)
    )
      continue;
    const functionNode = getDirectConstInitializer(binding);
    if (!isNodeOfType(functionNode, "ArrowFunctionExpression") || functionNode.async) continue;
    const keys = collectCoveredListenerKeys(
      functionNode,
      owner,
      effectIndex,
      declaredBindings,
      scopes,
    );
    if (keys) overrides.set(binding, keys);
  }
  return overrides.size > 0 ? overrides : undefined;
};
