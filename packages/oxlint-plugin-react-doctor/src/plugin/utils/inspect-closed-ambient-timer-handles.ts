import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType as is } from "./is-node-of-type.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { walkAst } from "./walk-ast.js";

/** These callbacks must compare resolved symbols with the selected module/export
 * binder. Source names and user settings are not sufficient evidence. */
export interface CertifiedDocumentBindings {
  readonly isAdditionalReadonlyHookDependency?: (
    call: EsTreeNodeOfType<"CallExpression">,
    module: SourceProjectModule,
  ) => boolean;
  readonly isDocumentGetter: (
    symbol: SymbolDescriptor | null,
    module: SourceProjectModule,
  ) => boolean;
  readonly isWindowGetter: (
    symbol: SymbolDescriptor | null,
    module: SourceProjectModule,
  ) => boolean;
}

const WINDOW_SCALARS = new Set([
  "innerWidth",
  "innerHeight",
  "scrollX",
  "scrollY",
  "devicePixelRatio",
]);
const WINDOW_METHODS = new Set(["setTimeout", "clearTimeout", "getComputedStyle", "matchMedia"]);
const DOCUMENT_FIELDS = new Set([
  "body",
  "documentElement",
  "activeElement",
  "fullscreenElement",
  "webkitFullscreenElement",
  "mozFullScreenElement",
  "msFullscreenElement",
  "fullscreenEnabled",
  "webkitFullscreenEnabled",
  "mozFullScreenEnabled",
  "msFullscreenEnabled",
]);
const DOCUMENT_METHODS = new Set([
  "querySelector",
  "exitFullscreen",
  "webkitExitFullscreen",
  "mozCancelFullScreen",
  "msExitFullscreen",
  "exitPictureInPicture",
]);
const READONLY_DEPENDENCY_HOOKS = new Set([
  "useEffect",
  "useLayoutEffect",
  "useCallback",
  "useMemo",
]);
const ANCHOR_PROPERTIES = new Set(["rel", "download", "target", "href", "origin"]);

const member = (
  node: EsTreeNode | null | undefined,
  name?: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  is(node, "MemberExpression") &&
  !node.computed &&
  is(node.property, "Identifier") &&
  (name === undefined || node.property.name === name);

const isDirectCall = (node: EsTreeNode): boolean =>
  is(node.parent, "CallExpression") && node.parent.callee === node;

const isMutation = (node: EsTreeNode): boolean =>
  is(node.parent, "UpdateExpression") ||
  (is(node.parent, "AssignmentExpression") && node.parent.left === node) ||
  (is(node.parent, "UnaryExpression") && node.parent.operator === "delete");

const transparent = (node: EsTreeNode): EsTreeNode => {
  node = stripParenExpression(node);
  while (
    is(node, "TSAsExpression") ||
    is(node, "TSNonNullExpression") ||
    is(node, "TSTypeAssertion")
  )
    node = stripParenExpression(node.expression);
  return node;
};

/** A local operation check, supplementary to selected native browser entry,
 * complete module graph, context binding, and owned timer-array proofs. It does
 * not itself authorize suppression or establish an initial stock realm. */
export const inspectAmbientTimerSourceModule = (
  module: SourceProjectModule,
  bindings: CertifiedDocumentBindings,
): readonly string[] => {
  const program = module.programNode;
  const scopes: ScopeAnalysis = module.scopes;
  const issues = new Set<string>();
  const aliases = new Set<SymbolDescriptor>();
  const documentResults: EsTreeNode[] = [];
  const getterResults: EsTreeNodeOfType<"CallExpression">[] = [];
  const global = (node: EsTreeNode, name: string): boolean =>
    is(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

  const isDocumentWindowAdapter = (fallback: EsTreeNode | null | undefined): boolean => {
    if (!fallback) return false;
    const logical = fallback.parent;
    if (
      !is(logical, "LogicalExpression") ||
      logical.operator !== "||" ||
      logical.right !== fallback
    )
      return false;
    const receiver = is(logical.left, "ChainExpression") ? logical.left.expression : logical.left;
    if (!member(receiver, "defaultView") || !receiver.optional) return false;
    const invocation = receiver.object;
    if (
      !is(invocation, "CallExpression") ||
      invocation.optional ||
      !is(invocation.callee, "Identifier") ||
      !bindings.isDocumentGetter(scopes.symbolFor(invocation.callee), module) ||
      invocation.arguments.length !== 1 ||
      !is(invocation.arguments[0], "Identifier")
    )
      return false;
    const arrow = logical.parent;
    if (
      !is(arrow, "ArrowFunctionExpression") ||
      arrow.async ||
      arrow.body !== logical ||
      arrow.params.length !== 1 ||
      !is(arrow.params[0], "Identifier") ||
      !scopes.symbolFor(arrow.params[0]) ||
      scopes.symbolFor(arrow.params[0]) !== scopes.symbolFor(invocation.arguments[0])
    )
      return false;
    const declaration = arrow.parent;
    return (
      is(declaration, "VariableDeclarator") &&
      declaration.init === arrow &&
      is(declaration.id, "Identifier") &&
      is(declaration.parent, "VariableDeclaration") &&
      declaration.parent.kind === "const" &&
      bindings.isWindowGetter(scopes.symbolFor(declaration.id), module)
    );
  };

  const nativeDocumentCall = (node: EsTreeNode | null, method: string, argument: string): boolean =>
    is(node, "CallExpression") &&
    !node.optional &&
    member(node.callee, method) &&
    global(node.callee.object, "document") &&
    node.arguments.length === 1 &&
    is(node.arguments[0], "Literal") &&
    node.arguments[0].value === argument;

  const closedAnchor = (identifier: EsTreeNodeOfType<"Identifier">): SymbolDescriptor | null => {
    const symbol = scopes.symbolFor(identifier);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !is(declaration, "VariableDeclarator") ||
      !nativeDocumentCall(declaration.init, "createElement", "a") ||
      !hasCompleteSymbolReferences(symbol, program, scopes)
    )
      return null;
    const closed = symbol.references.every(({ identifier: use, flag }) => {
      const parent = use.parent;
      if (flag !== "read") return false;
      if (
        is(parent, "CallExpression") &&
        parent.arguments.length === 1 &&
        parent.arguments[0] === use &&
        is(parent.callee, "Identifier")
      )
        return true; // All callees are checked against the exact private helper below.
      return (
        member(parent) &&
        parent.object === use &&
        is(parent.property, "Identifier") &&
        ANCHOR_PROPERTIES.has(parent.property.name) &&
        !is(parent.parent, "UpdateExpression") &&
        !(is(parent.parent, "UnaryExpression") && parent.parent.operator === "delete")
      );
    });
    return closed ? symbol : null;
  };

  const isClosedNativeEventView = (view: EsTreeNode): boolean => {
    const initialize = view.parent;
    if (
      !is(initialize, "CallExpression") ||
      initialize.optional ||
      initialize.arguments.length !== 15 ||
      initialize.arguments[3] !== view ||
      !member(initialize.callee, "initMouseEvent") ||
      !is(initialize.callee.object, "Identifier")
    )
      return false;
    const event = scopes.symbolFor(initialize.callee.object);
    const declaration = event?.declarationNode;
    if (
      !event ||
      event.kind !== "const" ||
      !is(declaration, "VariableDeclarator") ||
      !nativeDocumentCall(declaration.init, "createEvent", "MouseEvents") ||
      !hasCompleteSymbolReferences(event, program, scopes)
    )
      return false;
    let dispatch: EsTreeNodeOfType<"CallExpression"> | undefined;
    if (
      !event.references.every(({ identifier: use, flag }) => {
        const parent = use.parent;
        if (flag !== "read") return false;
        if (parent === initialize.callee && member(parent) && parent.object === use) return true;
        if (
          is(parent, "CallExpression") &&
          !parent.optional &&
          parent.arguments.length === 1 &&
          parent.arguments[0] === use &&
          member(parent.callee, "dispatchEvent") &&
          is(parent.callee.object, "Identifier") &&
          !dispatch
        ) {
          dispatch = parent;
          return true;
        }
        return false;
      }) ||
      !dispatch
    )
      return false;
    let owner: EsTreeNode | null | undefined = declaration;
    while (
      owner &&
      !is(owner, "FunctionDeclaration") &&
      !is(owner, "FunctionExpression") &&
      !is(owner, "ArrowFunctionExpression")
    )
      owner = owner.parent;
    if (
      !is(owner, "FunctionDeclaration") ||
      owner.parent !== program ||
      !owner.id ||
      owner.params.length !== 1 ||
      !is(owner.params[0], "Identifier") ||
      !member(dispatch.callee) ||
      !is(dispatch.callee.object, "Identifier")
    )
      return false;
    const parameter = scopes.symbolFor(owner.params[0]);
    if (
      !parameter ||
      scopes.symbolFor(dispatch.callee.object) !== parameter ||
      !hasCompleteSymbolReferences(parameter, program, scopes) ||
      !parameter.references.every(
        ({ identifier: use, flag }) =>
          flag === "read" &&
          member(use.parent, "dispatchEvent") &&
          use.parent.object === use &&
          isDirectCall(use.parent),
      )
    )
      return false;
    // A function's declaration identifier may resolve to its recursion binding;
    // callers must resolve to the enclosing module's declaration binding.
    const callable = scopes.rootScope.symbolsByName.get(owner.id.name);
    if (
      !callable ||
      callable.declarationNode !== owner ||
      callable.references.length === 0 ||
      !hasCompleteSymbolReferences(callable, program, scopes)
    )
      return false;
    const anchors = new Set<SymbolDescriptor>();
    for (const { identifier: use, flag } of callable.references) {
      const parent = use.parent;
      if (
        flag !== "read" ||
        !is(parent, "CallExpression") ||
        parent.optional ||
        parent.callee !== use ||
        parent.arguments.length !== 1 ||
        !is(parent.arguments[0], "Identifier")
      )
        return false;
      const anchor = closedAnchor(parent.arguments[0]);
      if (!anchor) return false;
      anchors.add(anchor);
    }
    for (const anchor of anchors)
      for (const { identifier: use } of anchor.references) {
        const parent = use.parent;
        if (
          is(parent, "CallExpression") &&
          parent.arguments.some((argument) => argument === use) &&
          (!is(parent.callee, "Identifier") || scopes.symbolFor(parent.callee) !== callable)
        )
          return false;
      }
    return true;
  };

  const isReadonlyHookDependency = (use: EsTreeNode): boolean => {
    const tuple = use.parent;
    const call = tuple?.parent;
    return (
      is(tuple, "ArrayExpression") &&
      is(call, "CallExpression") &&
      !call.optional &&
      call.arguments[1] === tuple &&
      tuple.elements.every((element) => is(element, "Identifier")) &&
      (isReactApiCall(call, READONLY_DEPENDENCY_HOOKS, scopes) ||
        bindings.isAdditionalReadonlyHookDependency?.(call, module) === true)
    );
  };

  const isClosedDocumentListener = (argument: EsTreeNode): boolean => {
    let fn: EsTreeNode | null = argument;
    if (is(fn, "Identifier")) {
      const symbol = scopes.symbolFor(fn);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        symbol.references.some((reference) => reference.flag !== "read")
      )
        return false;
      fn = symbol.initializer;
    }
    if (
      is(fn, "CallExpression") &&
      !fn.optional &&
      is(fn.callee, "Identifier") &&
      fn.arguments.every((value) => is(value, "Literal"))
    ) {
      const factory = scopes.symbolFor(fn.callee);
      const initializer = factory?.initializer;
      if (
        !factory ||
        factory.kind !== "const" ||
        !is(initializer, "ArrowFunctionExpression") ||
        initializer.async ||
        !is(initializer.body, "ArrowFunctionExpression")
      )
        return false;
      fn = initializer.body;
    }
    if ((!is(fn, "ArrowFunctionExpression") && !is(fn, "FunctionExpression")) || fn.async)
      return false;
    if (fn.params.length === 0) return true;
    if (fn.params.length !== 1 || !is(fn.params[0], "Identifier")) return false;
    const parameter = scopes.symbolFor(fn.params[0]);
    return Boolean(
      parameter &&
      hasCompleteSymbolReferences(parameter, program, scopes) &&
      parameter.references.every(({ identifier: use, flag }) => {
        const property = use.parent;
        return (
          flag === "read" &&
          member(property, "target") &&
          property.object === use &&
          is(property.parent, "BinaryExpression") &&
          ["===", "!=="].includes(property.parent.operator)
        );
      }),
    );
  };

  const isFiniteEventName = (argument: EsTreeNode): boolean => {
    if (is(argument, "Literal")) return typeof argument.value === "string";
    if (!is(argument, "Identifier")) return false;
    const symbol = scopes.symbolFor(argument);
    const arrow = symbol?.scope.node;
    if (
      !symbol ||
      symbol.kind !== "parameter" ||
      !is(arrow, "ArrowFunctionExpression") ||
      arrow.async ||
      arrow.params.length !== 1 ||
      arrow.params[0] !== symbol.bindingIdentifier ||
      !hasCompleteSymbolReferences(symbol, program, scopes) ||
      symbol.references.some((reference) => reference.flag !== "read")
    )
      return false;
    const call = arrow.parent;
    return (
      is(call, "CallExpression") &&
      !call.optional &&
      call.arguments.length === 1 &&
      call.arguments[0] === arrow &&
      member(call.callee, "map") &&
      !call.callee.optional &&
      is(call.callee.object, "ArrayExpression") &&
      call.callee.object.elements.length > 0 &&
      call.callee.object.elements.every(
        (element) => is(element, "Literal") && typeof element.value === "string",
      )
    );
  };

  const isAllowedDocumentRead = (value: EsTreeNode): boolean => {
    const property = value.parent;
    if (
      !member(property) ||
      property.object !== value ||
      !is(property.property, "Identifier") ||
      isMutation(property)
    )
      return false;
    const key = property.property.name;
    if (DOCUMENT_FIELDS.has(key)) return true;
    if (DOCUMENT_METHODS.has(key))
      return (
        isDirectCall(property) ||
        (is(property.parent, "IfStatement") && property.parent.test === property)
      );
    if (
      (key === "addEventListener" || key === "removeEventListener") &&
      is(property.parent, "CallExpression") &&
      property.parent.callee === property &&
      property.parent.arguments.length === 2 &&
      isFiniteEventName(property.parent.arguments[0]!) &&
      isClosedDocumentListener(property.parent.arguments[1]!)
    )
      return true;
    return false;
  };

  const isOwnedGetterReturn = (symbol: SymbolDescriptor, use: EsTreeNode): boolean => {
    const declaration = symbol.declarationNode;
    const property = use.parent;
    if (
      !is(symbol.initializer, "ArrowFunctionExpression") ||
      !is(declaration, "VariableDeclarator") ||
      !is(declaration.parent, "VariableDeclaration") ||
      !is(declaration.parent.parent, "BlockStatement") ||
      !is(property, "Property") ||
      property.value !== use ||
      property.kind !== "init" ||
      property.computed ||
      !is(property.parent, "ObjectExpression") ||
      !is(property.parent.parent, "ReturnStatement")
    )
      return false;
    return (
      property.parent.parent.argument === property.parent &&
      property.parent.parent.parent === declaration.parent.parent
    );
  };

  const isForwardedDocumentResult = (invocation: EsTreeNode): boolean => {
    const parent = invocation.parent;
    if (!member(parent, "defaultView") || !parent.optional) return false;
    const logical = is(parent.parent, "ChainExpression") ? parent.parent.parent : parent.parent;
    return is(logical, "LogicalExpression") && isDocumentWindowAdapter(logical.right);
  };

  walkAst(program, (node) => {
    if (
      is(node, "MemberExpression") &&
      isMutation(node) &&
      ["setTimeout", "clearTimeout"].includes(getResolvedStaticPropertyName(node, scopes) ?? "")
    )
      issues.add("timer-member-write");
    if (is(node, "MemberExpression") && getResolvedStaticPropertyName(node, scopes) === "view") {
      const call = node.parent;
      const result = is(call?.parent, "ChainExpression") ? call.parent : call;
      const argument = is(call, "CallExpression") ? call.arguments[0] : undefined;
      const ignoredNotification =
        !node.computed &&
        is(node.object, "Identifier") &&
        is(call, "CallExpression") &&
        call.optional &&
        call.callee === node &&
        call.arguments.length === 1 &&
        is(argument, "ObjectExpression") &&
        argument.properties.length === 1 &&
        argument.properties.every(
          (property) =>
            is(property, "Property") &&
            property.kind === "init" &&
            !property.computed &&
            is(property.key, "Identifier") &&
            property.key.name === "index",
        ) &&
        is(result?.parent, "ExpressionStatement");
      if (!ignoredNotification) issues.add("unproved-event-window-view");
    }
    if (
      is(node, "Property") &&
      is(node.parent, "ObjectPattern") &&
      ((is(node.key, "Identifier") && node.key.name === "view") ||
        (is(node.key, "Literal") && node.key.value === "view"))
    )
      issues.add("unproved-destructured-window-view");
    if (
      is(node, "MemberExpression") &&
      isMutation(node) &&
      ["innerHTML", "outerHTML"].includes(getResolvedStaticPropertyName(node, scopes) ?? "")
    )
      issues.add("imperative-html-write");
    if (
      is(node, "CallExpression") &&
      member(node.callee) &&
      is(node.callee.property, "Identifier") &&
      [
        "append",
        "prepend",
        "appendChild",
        "insertBefore",
        "replaceChild",
        "replaceWith",
        "insertAdjacentHTML",
        "write",
        "writeln",
      ].includes(node.callee.property.name)
    )
      issues.add("unproved-imperative-dom-insertion");
    if (
      is(node, "JSXOpeningElement") &&
      is(node.name, "JSXIdentifier") &&
      ["script", "iframe", "object", "embed"].includes(node.name.name)
    )
      issues.add("executable-jsx-predecessor");
    if (
      is(node, "Identifier") &&
      ["Window", "Document", "HTMLDocument", "Reflect", "Function", "eval"].includes(node.name) &&
      scopes.isGlobalReference(node) &&
      !isTypeScriptTypePosition(node)
    )
      issues.add("alternate-native-intrinsic-route");
    if (
      is(node, "MemberExpression") &&
      ["constructor", "__proto__"].includes(getResolvedStaticPropertyName(node, scopes) ?? "")
    )
      issues.add("reflective-native-handle");
    if (
      is(node, "MemberExpression") &&
      node.computed &&
      getResolvedStaticPropertyName(node, scopes) === "defaultView"
    )
      issues.add("computed-document-window");
    if (
      is(node, "CallExpression") &&
      is(node.callee, "MemberExpression") &&
      node.callee.computed &&
      getResolvedStaticPropertyName(node.callee, scopes) === null
    )
      issues.add("opaque-computed-invocation");
    if (
      is(node, "CallExpression") &&
      member(node.callee, "createElement") &&
      is(node.arguments[0], "Literal") &&
      ["script", "iframe", "object", "embed"].includes(
        String(node.arguments[0].value).toLowerCase(),
      )
    )
      issues.add("executable-dom-predecessor");
    if (
      is(node, "Identifier") &&
      ["globalThis", "self", "frames", "parent", "top", "opener"].includes(node.name) &&
      scopes.isGlobalReference(node)
    )
      issues.add("alternate-global-handle");
    if (member(node, "defaultView")) {
      const parent = is(node.parent, "ChainExpression") ? node.parent.parent : node.parent;
      if (!isDocumentWindowAdapter(is(parent, "LogicalExpression") ? parent.right : undefined))
        issues.add("unproved-document-window");
    }
    if (is(node, "Identifier") && scopes.referenceFor(node)) {
      const symbol = scopes.symbolFor(node);
      if (
        symbol &&
        node !== symbol.bindingIdentifier &&
        !(
          is(node.parent, "Property") &&
          node.parent.key === node &&
          node.parent.value !== node &&
          !node.parent.computed
        ) &&
        (bindings.isDocumentGetter(symbol, module) || bindings.isWindowGetter(symbol, module))
      ) {
        if (
          !isDirectCall(node) &&
          !isOwnedGetterReturn(symbol, node) &&
          !isReadonlyHookDependency(node)
        )
          issues.add("document-getter-binding-escape");
      }
    }
    if (is(node, "CallExpression") && is(node.callee, "Identifier")) {
      const symbol = scopes.symbolFor(node.callee);
      if (bindings.isWindowGetter(symbol, module)) getterResults.push(node);
      if (bindings.isDocumentGetter(symbol, module) && !isForwardedDocumentResult(node)) {
        if (node.arguments.length !== 0) issues.add("unproved-document-getter-argument");
        documentResults.push(node);
      }
    }
    if (member(node, "ownerDocument")) {
      // The exact certified local document getter owns this forwarding read.
      const chain = is(node.parent, "ChainExpression") ? node.parent : node;
      const logical = chain.parent;
      const arrow = logical?.parent;
      const declaration = arrow?.parent;
      const certified =
        is(logical, "LogicalExpression") &&
        logical.operator === "||" &&
        is(arrow, "ArrowFunctionExpression") &&
        arrow.body === logical &&
        is(declaration, "VariableDeclarator") &&
        is(declaration.id, "Identifier") &&
        bindings.isDocumentGetter(scopes.symbolFor(declaration.id), module);
      if (!certified) documentResults.push(node);
    }
    if (
      is(node, "Identifier") &&
      ["setTimeout", "clearTimeout"].includes(node.name) &&
      scopes.isGlobalReference(node) &&
      !isDirectCall(node)
    )
      issues.add("bare-timer-write-or-escape");
    if (global(node, "document")) {
      const parent = node.parent;
      if (member(parent, "body") && !isMutation(parent)) return;
      if (
        member(parent) &&
        parent.object === node &&
        isDirectCall(parent) &&
        is(parent.parent, "CallExpression") &&
        is(parent.property, "Identifier")
      ) {
        const invocation = parent.parent;
        if (parent.property.name === "getElementById") return;
        if (
          parent.property.name === "createElement" &&
          invocation.arguments.length === 1 &&
          is(invocation.arguments[0], "Literal") &&
          invocation.arguments[0].value === "a"
        )
          return;
        if (
          parent.property.name === "createEvent" &&
          invocation.arguments.length === 1 &&
          is(invocation.arguments[0], "Literal") &&
          invocation.arguments[0].value === "MouseEvents"
        )
          return;
      }
      const logical = node.parent;
      const arrow = logical?.parent;
      const declaration = arrow?.parent;
      if (
        is(logical, "LogicalExpression") &&
        logical.operator === "||" &&
        logical.right === node &&
        is(arrow, "ArrowFunctionExpression") &&
        arrow.body === logical &&
        !arrow.async &&
        is(declaration, "VariableDeclarator") &&
        is(declaration.id, "Identifier") &&
        bindings.isDocumentGetter(scopes.symbolFor(declaration.id), module)
      )
        return;
      issues.add("document-write-or-escape");
    }
    if (!global(node, "window")) return;
    let value = node;
    while (value.parent && transparent(value.parent) === node) value = value.parent;
    if (is(value.parent, "UnaryExpression") && value.parent.operator === "typeof") return;
    if (isDocumentWindowAdapter(value) || isClosedNativeEventView(value)) return;
    const parent = value.parent;
    if (member(parent) && parent.object === value && is(parent.property, "Identifier")) {
      if (WINDOW_METHODS.has(parent.property.name) && isDirectCall(parent)) return;
      if (
        parent.property.name === "chrome" &&
        is(parent.parent, "UnaryExpression") &&
        parent.parent.operator === "!"
      )
        return;
      if (WINDOW_SCALARS.has(parent.property.name) && !isMutation(parent)) return;
      if (
        parent.property.name === "location" &&
        member(parent.parent, "origin") &&
        !isMutation(parent.parent)
      )
        return;
    }
    issues.add("window-write-or-escape");
  });
  const documentAliases = new Set<SymbolDescriptor>();
  for (const result of documentResults) {
    const parent = result.parent;
    if (isAllowedDocumentRead(result)) continue;
    if (
      is(parent, "VariableDeclarator") &&
      parent.init === result &&
      is(parent.parent, "VariableDeclaration") &&
      parent.parent.kind === "const"
    ) {
      if (is(parent.id, "Identifier")) {
        const symbol = scopes.symbolFor(parent.id);
        if (symbol && hasCompleteSymbolReferences(symbol, program, scopes)) {
          documentAliases.add(symbol);
          continue;
        }
      }
      if (
        is(parent.id, "ObjectPattern") &&
        parent.id.properties.every(
          (property) =>
            is(property, "Property") &&
            property.kind === "init" &&
            !property.computed &&
            is(property.key, "Identifier") &&
            DOCUMENT_FIELDS.has(property.key.name) &&
            is(property.value, "Identifier"),
        )
      )
        continue;
    }
    issues.add("document-result-escape-or-operation");
  }
  for (const alias of documentAliases)
    for (const { identifier: use, flag } of alias.references) {
      const parent = use.parent;
      if (flag !== "read" || !isAllowedDocumentRead(use))
        issues.add("document-alias-escape-or-operation");
    }
  for (const invocation of getterResults) {
    if (invocation.arguments.length !== 0) {
      issues.add("unproved-window-getter-argument");
      continue;
    }
    const declaration = invocation.parent;
    if (
      is(declaration, "VariableDeclarator") &&
      declaration.init === invocation &&
      is(declaration.parent, "VariableDeclaration") &&
      declaration.parent.kind === "const"
    ) {
      if (is(declaration.id, "Identifier")) {
        const symbol = scopes.symbolFor(declaration.id);
        if (symbol) aliases.add(symbol);
        else issues.add("unknown-window-alias");
        continue;
      }
      if (
        is(declaration.id, "ObjectPattern") &&
        declaration.id.properties.every(
          (property) =>
            is(property, "Property") &&
            !property.computed &&
            is(property.key, "Identifier") &&
            WINDOW_SCALARS.has(property.key.name) &&
            is(property.value, "Identifier"),
        )
      )
        continue;
    }
    issues.add("window-result-escape");
  }
  for (const alias of aliases)
    for (const { identifier: use, flag } of alias.references) {
      const parent = use.parent;
      if (
        flag !== "read" ||
        !member(parent) ||
        parent.object !== use ||
        !is(parent.property, "Identifier")
      ) {
        issues.add("window-alias-write-or-escape");
        continue;
      }
      if (WINDOW_METHODS.has(parent.property.name) && isDirectCall(parent)) continue;
      if (WINDOW_SCALARS.has(parent.property.name) && !isMutation(parent)) continue;
      issues.add("window-alias-operation");
    }
  return [...issues];
};

export const inspectAmbientTimerGraph = (
  modules: ReadonlyMap<string, SourceProjectModule>,
  bindings: CertifiedDocumentBindings,
): ReadonlyMap<string, readonly string[]> => {
  const issues = new Map<string, readonly string[]>();
  for (const [filename, module] of modules) {
    const failures = inspectAmbientTimerSourceModule(module, bindings);
    if (failures.length) issues.set(filename, failures);
  }
  return issues;
};
