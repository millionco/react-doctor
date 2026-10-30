import { HTML_TAGS } from "../../../constants/html-tags.js";
import {
  isDescendantScope,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isImportedFromReact,
  isReactApiCall,
  isReactNamespaceImport,
} from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NO_VALUE_COUNT,
  SINGLE_VALUE_COUNT,
  SNAPSHOT_ACTION_COUNT,
  SNAPSHOT_STATEMENT_COUNT,
  UNSUPPORTED_PROVIDER_GLOBALS,
  UNSUPPORTED_PROVIDER_SELECTORS,
  UNSUPPORTED_RUNTIME_TYPES,
} from "./callback-map-snapshot/constants.js";
import {
  getExternalReferenceKey,
  getSingleStatement,
  readReturnedAction,
  readStoreAction,
  type NullDetachActionInput,
  type StoreAction,
} from "./has-equivalent-null-detach-action.js";

const readonlyBindings = new WeakMap<SymbolDescriptor, boolean>();
const supportedPrograms = new WeakMap<ScopeAnalysis, boolean>();
const readonlyKeyPaths = new WeakMap<SymbolDescriptor, Map<string, boolean>>();

const isReadonly = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly = symbol.references.every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );
  readonlyBindings.set(symbol, readonly);
  return readonly;
};

const isRuntimeGlobalReference = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (scopes.isGlobalReference(identifier)) return true;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol));
};

const hasReadonlyLoadedReactUse = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (isNodeOfType(current.parent, "MemberExpression") && current.parent.object === current) {
    const member = current.parent;
    if (getResolvedStaticPropertyName(member, scopes) === null || isMemberMutationTarget(member))
      return false;
    current = findTransparentExpressionRoot(member);
  }
  const parent = current.parent;
  return (
    isNodeOfType(parent, "ExpressionStatement") ||
    (isNodeOfType(parent, "UnaryExpression") &&
      (parent.operator === "typeof" || parent.operator === "void")) ||
    (isNodeOfType(parent, "CallExpression") && parent.callee === current && !parent.optional)
  );
};

const hasSupportedLoaderUse = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const root = findTransparentExpressionRoot(identifier);
  if (
    isNodeOfType(root.parent, "UnaryExpression") &&
    (root.parent.operator === "typeof" || root.parent.operator === "void")
  )
    return true;
  const callee =
    identifier.name === "module" &&
    isNodeOfType(root.parent, "MemberExpression") &&
    root.parent.object === root &&
    !root.parent.optional &&
    getResolvedStaticPropertyName(root.parent, scopes) === "require"
      ? findTransparentExpressionRoot(root.parent)
      : root;
  const call = callee.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.callee !== callee ||
    call.arguments.length !== SINGLE_VALUE_COUNT ||
    (identifier.name === "module" && callee === root)
  )
    return false;
  const source = getStaticStringExpression(call.arguments[NO_VALUE_COUNT]);
  return Boolean(source && (source !== "react" || hasReadonlyLoadedReactUse(call, scopes)));
};

const isDirectInvocation = (node: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  return Boolean(
    parent &&
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === expression,
  );
};

const hasCallableUse = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visited = new Set<number>(),
): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  if (!parent) return true;
  if (isDirectInvocation(expression) || isWithinAssignmentTarget(expression)) return true;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
    return hasCallableUse(parent, scopes, visited);
  }
  if (
    (isNodeOfType(parent, "LogicalExpression") &&
      (parent.left === expression || parent.right === expression)) ||
    (isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === expression || parent.alternate === expression))
  ) {
    return hasCallableUse(parent, scopes, visited);
  }
  if (
    isNodeOfType(parent, "TaggedTemplateExpression") ||
    isNodeOfType(parent, "AwaitExpression") ||
    isNodeOfType(parent, "YieldExpression") ||
    isNodeOfType(parent, "SequenceExpression") ||
    isNodeOfType(parent, "AssignmentExpression") ||
    isNodeOfType(parent, "SpreadElement") ||
    isNodeOfType(parent, "Property") ||
    isNodeOfType(parent, "ArrayExpression") ||
    isNodeOfType(parent, "ReturnStatement")
  )
    return true;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === expression) {
    if (!isNodeOfType(parent.id, "Identifier")) return true;
    const symbol = scopes.symbolFor(parent.id);
    if (!symbol || symbol.kind !== "const" || !isReadonly(symbol) || visited.has(symbol.id))
      return true;
    const nextVisited = new Set([...visited, symbol.id]);
    return symbol.references.some((reference) =>
      hasCallableUse(reference.identifier, scopes, nextVisited),
    );
  }
  return false;
};

const hasClosedReactProvider = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    !isReadonly(symbol) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type") ||
    (isNodeOfType(symbol.declarationNode.parent, "ImportDeclaration") &&
      symbol.declarationNode.parent.importKind === "type")
  )
    return false;
  const isNamespace = isReactNamespaceImport(identifier, scopes);
  if (
    !isNamespace &&
    (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      getImportedName(symbol.declarationNode) === "default")
  )
    return false;
  return symbol.references.every(({ identifier: reference }) => {
    if (isTypeScriptTypePosition(reference)) return true;
    if (!isNamespace) return isDirectInvocation(reference);
    const member = reference.parent;
    return Boolean(
      member &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference &&
      !member.computed &&
      !member.optional &&
      isDirectInvocation(member),
    );
  });
};

const hasSupportedProgram = (scopes: ScopeAnalysis): boolean => {
  const cached = supportedPrograms.get(scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  const checkedReactSymbols = new Set<number>();
  walkAst(scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (("declare" in node && node.declare === true) || UNSUPPORTED_RUNTIME_TYPES.has(node.type)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier")) {
      const reference = scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      const isRuntimeGlobal = reference && isRuntimeGlobalReference(node, scopes);
      const isLoader = node.name === "require" || node.name === "module";
      if (
        reference &&
        ((isLoader && isRuntimeGlobal && !hasSupportedLoaderUse(node, scopes)) ||
          (symbol &&
            isErasedTypeScriptBinding(symbol) &&
            !hasRuntimeValueBinding(symbol) &&
            node.name !== "Map" &&
            !isLoader) ||
          (UNSUPPORTED_PROVIDER_GLOBALS.has(node.name) &&
            (node.name === "eval" || isRuntimeGlobal)))
      )
        supported = false;
      if (symbol && isImportedFromReact(symbol) && !checkedReactSymbols.has(symbol.id)) {
        checkedReactSymbols.add(symbol.id);
        if (!hasClosedReactProvider(node, scopes)) supported = false;
      }
      if (reference && node.name === "Map" && isRuntimeGlobal && !isDirectInvocation(node))
        supported = false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes, {
        allowConstTemplateLiteral: true,
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (propertyName && UNSUPPORTED_PROVIDER_SELECTORS.has(propertyName)) supported = false;
      if (
        !propertyName &&
        node.computed &&
        (isNodeOfType(node, "Property") || hasCallableUse(node, scopes))
      )
        supported = false;
    }
    return undefined;
  });
  supportedPrograms.set(scopes, supported);
  return supported;
};

const isDiscardedFocusObservation = (current: EsTreeNode): boolean => {
  const getMember = current.parent;
  if (
    !getMember ||
    !isNodeOfType(getMember, "MemberExpression") ||
    getMember.object !== current ||
    getMember.computed ||
    getMember.optional ||
    !isNodeOfType(getMember.property, "Identifier") ||
    getMember.property.name !== "get"
  )
    return false;
  const getCall = getMember.parent;
  if (
    !getCall ||
    !isNodeOfType(getCall, "CallExpression") ||
    getCall.callee !== getMember ||
    getCall.optional ||
    getCall.arguments.length !== SINGLE_VALUE_COUNT ||
    isNodeOfType(getCall.arguments[NO_VALUE_COUNT], "SpreadElement")
  )
    return false;
  const focusMember = getCall.parent;
  if (
    !focusMember ||
    !isNodeOfType(focusMember, "MemberExpression") ||
    focusMember.object !== getCall ||
    focusMember.computed ||
    !isNodeOfType(focusMember.property, "Identifier") ||
    focusMember.property.name !== "focus"
  )
    return false;
  const focusCall = focusMember.parent;
  if (
    !focusCall ||
    !isNodeOfType(focusCall, "CallExpression") ||
    focusCall.callee !== focusMember ||
    focusCall.arguments.length !== NO_VALUE_COUNT
  )
    return false;
  return isNodeOfType(findTransparentExpressionRoot(focusCall).parent, "ExpressionStatement");
};

const hasClosedRef = (
  current: EsTreeNode,
  snapshot: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(current, "MemberExpression") ||
    current.optional ||
    current.computed ||
    !isNodeOfType(current.object, "Identifier") ||
    !isNodeOfType(current.property, "Identifier") ||
    current.property.name !== "current"
  )
    return false;
  const refSymbol = resolveReactRefSymbol(current, scopes, { allowUnboundBareCalls: false });
  if (
    !refSymbol ||
    scopes.symbolFor(current.object) !== refSymbol ||
    refSymbol.kind !== "const" ||
    !isReadonly(refSymbol) ||
    !isNodeOfType(refSymbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(refSymbol.declarationNode.id, "Identifier") ||
    !refSymbol.initializer
  )
    return false;
  const owner = findEnclosingFunction(refSymbol.declarationNode);
  const ownerScope = owner && scopes.ownScopeFor(owner);
  if (
    !ownerScope ||
    owner === callback ||
    !isDescendantScope(scopes.scopeFor(callback), ownerScope)
  )
    return false;
  const initializer = stripParenExpression(refSymbol.initializer);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== SINGLE_VALUE_COUNT ||
    !isReactApiCall(initializer, "useRef", scopes, {
      allowGlobalReactNamespace: false,
      allowUnboundBareCalls: false,
    })
  )
    return false;
  const allocation = stripParenExpression(initializer.arguments[NO_VALUE_COUNT]);
  if (
    !isNodeOfType(allocation, "NewExpression") ||
    !isNodeOfType(allocation.callee, "Identifier") ||
    allocation.callee.name !== "Map" ||
    !isRuntimeGlobalReference(allocation.callee, scopes) ||
    allocation.arguments.length !== NO_VALUE_COUNT
  )
    return false;
  return refSymbol.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      member.property.name !== "current"
    )
      return false;
    return member === current ? member.parent === snapshot : isDiscardedFocusObservation(member);
  });
};

const proveReadonlyKeyPathAliases = (
  root: EsTreeNode,
  selectedPath: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  const pendingSymbols = [...getEquivalentSymbols(root, scopes)];
  if (!pendingSymbols.length) return false;
  const paths = new Map(pendingSymbols.map((symbol) => [symbol.id, selectedPath]));
  const checkedSymbols = new Set<number>();
  for (const symbol of pendingSymbols) {
    if (checkedSymbols.has(symbol.id)) continue;
    checkedSymbols.add(symbol.id);
    if (!isReadonly(symbol)) return false;
    const path = paths.get(symbol.id);
    if (!path) return false;
    for (const { identifier } of symbol.references) {
      if (isWithinAssignmentTarget(identifier)) return false;
      let expression = findTransparentExpressionRoot(identifier);
      const referencePath: string[] = [];
      while (
        isNodeOfType(expression.parent, "MemberExpression") &&
        expression.parent.object === expression
      ) {
        const member = expression.parent;
        const propertyName = getResolvedStaticPropertyName(member, scopes, {
          allowConstTemplateLiteral: true,
        });
        if (propertyName === null) return false;
        referencePath.push(propertyName);
        expression = findTransparentExpressionRoot(member);
      }
      if (
        referencePath.some((name, index) => index < path.length && path[index] !== name) ||
        referencePath.length >= path.length
      )
        continue;
      const remainingPath = path.slice(referencePath.length);
      const parent = expression.parent;
      if (!parent) return false;
      if (isNodeOfType(parent, "VariableDeclarator") && parent.init === expression) {
        if (!isNodeOfType(parent.id, "Identifier")) return false;
        const aliases = getEquivalentSymbols(parent.id, scopes);
        if (!aliases.length) return false;
        for (const alias of aliases) {
          const previousPath = paths.get(alias.id);
          if (
            previousPath &&
            (previousPath.length !== remainingPath.length ||
              previousPath.some((name, index) => remainingPath[index] !== name))
          )
            return false;
          paths.set(alias.id, remainingPath);
        }
        pendingSymbols.push(...aliases);
      } else if (
        isNodeOfType(parent, "CallExpression") ||
        isNodeOfType(parent, "NewExpression") ||
        isNodeOfType(parent, "TaggedTemplateExpression") ||
        isNodeOfType(parent, "AssignmentExpression") ||
        isNodeOfType(parent, "LogicalExpression") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        isNodeOfType(parent, "ArrayExpression") ||
        isNodeOfType(parent, "Property") ||
        isNodeOfType(parent, "ReturnStatement") ||
        isNodeOfType(parent, "SpreadElement") ||
        (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expression)
      ) {
        return false;
      }
    }
  }
  return true;
};

const hasReadonlyKeyPathAliases = (
  root: EsTreeNode,
  selectedPath: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(root);
  if (!symbol) return false;
  let paths = readonlyKeyPaths.get(symbol);
  if (!paths) {
    paths = new Map();
    readonlyKeyPaths.set(symbol, paths);
  }
  const path = JSON.stringify(selectedPath);
  const cached = paths.get(path);
  if (cached !== undefined) return cached;
  const readonly = proveReadonlyKeyPathAliases(root, selectedPath, scopes);
  paths.set(path, readonly);
  return readonly;
};

const getStableKey = (
  key: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const expression = stripParenExpression(key);
  if (isNodeOfType(expression, "Literal"))
    return typeof expression.value === "string" ? `literal:${expression.value}` : null;
  const serialized = getExternalReferenceKey(expression, callback, scopes);
  if (!serialized) return null;
  let root: EsTreeNode = expression;
  while (isNodeOfType(root, "MemberExpression")) root = stripParenExpression(root.object);
  if (!isNodeOfType(root, "Identifier")) return null;
  const equivalents = getEquivalentSymbols(root, scopes);
  if (!equivalents.length || equivalents.some((symbol) => !isReadonly(symbol))) return null;
  for (const symbol of equivalents) {
    const initializer = symbol.initializer && stripParenExpression(symbol.initializer);
    if (
      initializer &&
      isNodeOfType(initializer, "ObjectExpression") &&
      initializer.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.method ||
          property.computed,
      )
    )
      return null;
  }
  const pendingProperties: string[] = [];
  const checkedSymbols = new Set<number>();
  let value: EsTreeNode = expression;
  while (true) {
    while (isNodeOfType(value, "MemberExpression")) {
      if (value.optional || value.computed || !isNodeOfType(value.property, "Identifier"))
        return null;
      pendingProperties.unshift(value.property.name);
      value = stripParenExpression(value.object);
    }
    if (isNodeOfType(value, "Identifier")) {
      if (!hasReadonlyKeyPathAliases(value, pendingProperties, scopes)) return null;
      const symbol = scopes.symbolFor(value);
      if (!symbol || !isReadonly(symbol) || checkedSymbols.has(symbol.id)) return null;
      if (!pendingProperties.length || symbol.kind === "parameter")
        return `reference:${serialized}`;
      const initializer = getDirectConstInitializer(symbol);
      const declarationStart = getNodeStartIndex(symbol.declarationNode);
      const referenceStart = getNodeStartIndex(value);
      if (
        !initializer ||
        declarationStart < NO_VALUE_COUNT ||
        referenceStart < NO_VALUE_COUNT ||
        declarationStart >= referenceStart
      )
        return null;
      checkedSymbols.add(symbol.id);
      value = stripParenExpression(initializer);
      continue;
    }
    if (!isNodeOfType(value, "ObjectExpression")) return null;
    const names = new Set<string>();
    for (const property of value.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        property.computed
      )
        return null;
      const name = getResolvedStaticPropertyName(property, scopes);
      if (name === null || names.has(name)) return null;
      names.add(name);
    }
    const propertyName = pendingProperties.shift();
    if (propertyName === undefined) return `reference:${serialized}`;
    const propertyValue = getStaticObjectPropertyValue(value, propertyName);
    if (!propertyValue) return null;
    if (!pendingProperties.length) return `reference:${serialized}`;
    value = stripParenExpression(propertyValue);
  }
};

export const hasOwnedCallbackMapSnapshot = ({
  attribute,
  scopes,
}: NullDetachActionInput): boolean => {
  const opening = attribute.parent;
  if (
    !opening ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !HTML_TAGS.has(opening.name.name) ||
    getAuthoritativeJsxAttribute(opening.attributes, "ref") !== attribute ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  )
    return false;
  const callback = stripParenExpression(attribute.value.expression);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.params.length !== SINGLE_VALUE_COUNT
  )
    return false;
  const input = callback.params[NO_VALUE_COUNT];
  if (!isNodeOfType(input, "Identifier")) return false;
  const inputSymbol = scopes.symbolFor(input);
  if (
    !inputSymbol ||
    !isReadonly(inputSymbol) ||
    callback.body.body.length !== SNAPSHOT_STATEMENT_COUNT
  )
    return false;
  const [declaration, guard, returned] = callback.body.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== SINGLE_VALUE_COUNT ||
    !isNodeOfType(guard, "IfStatement") ||
    !guard.alternate
  )
    return false;
  const snapshot = declaration.declarations[NO_VALUE_COUNT];
  if (!isNodeOfType(snapshot.id, "Identifier") || !snapshot.init) return false;
  const snapshotSymbol = scopes.symbolFor(snapshot.id);
  const test = stripParenExpression(guard.test);
  if (
    !snapshotSymbol ||
    !isReadonly(snapshotSymbol) ||
    !isNodeOfType(test, "Identifier") ||
    scopes.symbolFor(test) !== inputSymbol
  )
    return false;
  const registration = readStoreAction(getSingleStatement(guard.consequent), "set");
  const detachment = readStoreAction(getSingleStatement(guard.alternate), "delete");
  const cleanup = readReturnedAction(returned);
  if (!registration?.value || !detachment || !cleanup) return false;
  const attached = stripParenExpression(registration.value);
  if (!isNodeOfType(attached, "Identifier") || scopes.symbolFor(attached) !== inputSymbol)
    return false;
  const actions: StoreAction[] = [registration, detachment, cleanup];
  const receivers = actions.map((action) => stripParenExpression(action.receiver));
  if (
    receivers.some(
      (receiver) =>
        !isNodeOfType(receiver, "Identifier") || scopes.symbolFor(receiver) !== snapshotSymbol,
    ) ||
    snapshotSymbol.references.length !== SNAPSHOT_ACTION_COUNT ||
    snapshotSymbol.references.some(({ identifier }) => !receivers.includes(identifier))
  )
    return false;
  const key = getStableKey(registration.key, callback, scopes);
  return Boolean(
    key &&
    actions.every((action) => getStableKey(action.key, callback, scopes) === key) &&
    hasClosedRef(stripParenExpression(snapshot.init), snapshot, callback, scopes) &&
    hasSupportedProgram(scopes),
  );
};
