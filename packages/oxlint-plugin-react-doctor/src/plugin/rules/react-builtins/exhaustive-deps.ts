import { closureCaptures } from "../../semantic/closure-captures.js";
import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { isDescendantScope } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Port of `oxc_linter::rules::react::exhaustive_deps`. Diffs the
// closure-captured set of an effect / memo callback against its
// declared dependency array. Built on top of Phase A's scope analyzer
// and Phase C's closure-capture helper.

const buildMissingDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` is missing dependency \`${depName}\` — list it in the dependency array, or call the hook unconditionally.`;
const buildUnnecessaryDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` has an unnecessary dependency \`${depName}\` — it isn't referenced inside the callback.`;
const buildDuplicateDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` has duplicate dependency \`${depName}\`.`;
const buildLiteralDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` was passed a literal as a dependency. Literals never change so they cannot trigger an update — remove them from the dependency array.`;
const buildRefCurrentDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` shouldn't include \`${depName}\` in the dependency array — mutable values like \`.current\` aren't valid deps; depend on \`${depName.replace(/\.current$/, "")}\` itself instead.`;
const buildNonArrayDepsMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a second argument which is not an array literal. This means oxlint cannot statically verify whether the dependencies are exhaustive — replace the variable with an inline array.`;
const buildMissingDepArrayMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` does nothing when called with only one argument — pass a dependency array as the second argument.`;
const buildMissingCallbackMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` requires an effect callback — pass a function as the first argument.`;
const buildEffectEventDepMessage = (depName: string): string =>
  `Functions returned from \`useEffectEvent\` must not be included in the dependency array. Remove \`${depName}\` from the list.`;
const buildSpreadDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a spread element in its dependency array. This means oxlint cannot statically verify whether the dependencies are exhaustive.`;
const buildComplexDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a complex expression in the dependency array. Extract it to a separate variable so it can be statically checked.`;
const buildAsyncEffectMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` received an async callback. Put the async function inside the effect instead.`;
const buildUnknownCallbackMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` received a function whose dependencies are unknown. Pass an inline function instead.`;
const buildUnstableDepMessage = (hookName: string, depName: string): string =>
  `The \`${depName}\` value makes the dependencies of \`${hookName}\` change on every render. Move it inside the hook callback or wrap it in its own memoization hook.`;
const buildSetStateWithoutDepsMessage = (hookName: string, setterName: string): string =>
  `React Hook \`${hookName}\` contains a call to \`${setterName}\`. Without a dependency array, this can lead to an infinite chain of updates.`;
const buildRefCleanupMessage = (depName: string): string =>
  `The ref value \`${depName}\` will likely have changed by the time this effect cleanup function runs. Copy it to a variable inside the hook callback and use that variable in cleanup.`;
const buildAssignmentMessage = (name: string): string =>
  `Assignments to the \`${name}\` variable from inside a React Hook will be lost after each render. Store it in a ref to preserve the value over time.`;

interface ExhaustiveDepsSettings {
  additionalHooks?: string;
  additionalEffectHooks?: string;
  enableDangerousAutofixThisMayCauseInfiniteLoops?: boolean;
  experimental_autoDependenciesHooks?: ReadonlyArray<string>;
  requireExplicitEffectDeps?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ExhaustiveDepsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const reactHooks = settings?.["react-hooks"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { exhaustiveDeps?: ExhaustiveDepsSettings }).exhaustiveDeps ?? {})
      : {};
  const upstreamSettings =
    typeof reactHooks === "object" && reactHooks !== null
      ? (reactHooks as ExhaustiveDepsSettings)
      : {};
  return {
    additionalHooks:
      ruleSettings.additionalHooks ??
      ruleSettings.additionalEffectHooks ??
      upstreamSettings.additionalHooks ??
      upstreamSettings.additionalEffectHooks ??
      "",
    additionalEffectHooks:
      ruleSettings.additionalEffectHooks ?? upstreamSettings.additionalEffectHooks ?? "",
    enableDangerousAutofixThisMayCauseInfiniteLoops:
      ruleSettings.enableDangerousAutofixThisMayCauseInfiniteLoops ?? false,
    experimental_autoDependenciesHooks:
      ruleSettings.experimental_autoDependenciesHooks ??
      upstreamSettings.experimental_autoDependenciesHooks ??
      [],
    requireExplicitEffectDeps:
      ruleSettings.requireExplicitEffectDeps ?? upstreamSettings.requireExplicitEffectDeps ?? false,
  };
};

// Hooks whose callback captures must match a deps array.
const HOOKS_REQUIRING_DEPS_MATCH: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useCallback",
  "useMemo",
  "useImperativeHandle",
  "useInsertionEffect",
]);

// Hooks where the deps array is REQUIRED (silently doing nothing
// without one is a common bug). useEffect / useLayoutEffect /
// useInsertionEffect tolerate omitting deps (intentional
// run-on-every-render); useMemo / useCallback / useImperativeHandle
// do not.
const HOOKS_REQUIRING_DEPS_ARRAY: ReadonlySet<string> = new Set(["useMemo", "useCallback"]);

const EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

const buildAdditionalHooksRegex = (additional: string): RegExp | null => {
  if (!additional) return null;
  try {
    return new RegExp(additional);
  } catch {
    return null;
  }
};

const getHookName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return null;
};

const getCallExpressionCalleeName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    isNodeOfType(callee.property, "Identifier") &&
    !callee.computed
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
};

const REACT_HOC_NAMES: ReadonlySet<string> = new Set([
  "forwardRef",
  "memo",
  "React.forwardRef",
  "React.memo",
]);

const inferFunctionName = (functionNode: EsTreeNode): string | null => {
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return functionNode.id.name;
  }
  let parent = functionNode.parent;
  while (parent && isNodeOfType(parent, "CallExpression")) {
    const calleeName = getCallExpressionCalleeName(parent);
    if (calleeName && REACT_HOC_NAMES.has(calleeName)) parent = parent.parent ?? null;
    else break;
  }
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  return null;
};

const findEnclosingComponentOrHookFunction = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression")
    ) {
      const functionName = inferFunctionName(current);
      if (functionName && isReactComponentOrHookName(functionName)) return current;
    }
    current = current.parent ?? null;
  }
  return null;
};

const getCallbackArgumentIndex = (hookName: string): number =>
  hookName === "useImperativeHandle" ? 1 : 0;

const getDepsArgumentIndex = (hookName: string): number =>
  hookName === "useImperativeHandle" ? 2 : 1;

// True for symbols whose returned value (or destructured pieces) are
// stable across re-renders and don't need to live in deps arrays:
//   useState's setter (`setX`)
//   useReducer's dispatch
//   useRef's ref object
//   useEffectEvent's return value
//   primitive-literal local consts (the value never changes between
//     renders unless the literal does)
const symbolHasStableHookOrigin = (symbol: SymbolDescriptor): boolean => {
  if (symbol.references.some((reference) => reference.flag !== "read")) return false;
  // We need the binding's parent context. The symbol's
  // declarationNode is the VariableDeclarator (when destructured) or
  // the binding identifier itself.
  let declarator: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declarator && declarator.type !== "VariableDeclarator") {
    declarator = declarator.parent ?? null;
  }
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const initializerRaw = declarator.init;
  if (!initializerRaw) return false;
  const initializer = unwrapExpression(initializerRaw);

  // Primitive literal initializer of a `const` binding — the value
  // cannot change between renders, so the captured reference is
  // structurally stable for dep-array purposes. `let` / `var` could
  // be reassigned and don't qualify.
  if (symbol.kind === "const") {
    if (
      isNodeOfType(initializer, "Literal") &&
      (initializer.value === null ||
        typeof initializer.value === "number" ||
        typeof initializer.value === "string" ||
        typeof initializer.value === "boolean")
    ) {
      return true;
    }
    if (
      isNodeOfType(initializer, "TemplateLiteral") &&
      getStaticTemplateLiteralValue(initializer) !== null
    ) {
      return true;
    }
  }

  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const initializerHookName = getHookName(initializer.callee);
  if (!initializerHookName) return false;
  // useRef returns a stable ref; the binding itself is the ref.
  if (initializerHookName === "useRef") return true;
  // useEffectEvent returns a stable callback (React's RFC).
  if (initializerHookName === "useEffectEvent") return true;
  // useState / useReducer: the SECOND destructure element (setter /
  // dispatch) is stable; the first is mutable.
  if (
    initializerHookName === "useState" ||
    initializerHookName === "useReducer" ||
    initializerHookName === "useActionState" ||
    initializerHookName === "useTransition"
  ) {
    if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
    const STABLE_RETURN_INDEX = 1;
    const elements = declarator.id.elements;
    const stableElement = elements[STABLE_RETURN_INDEX];
    if (!stableElement) return false;
    const innerBinding = isNodeOfType(stableElement as EsTreeNode, "AssignmentPattern")
      ? (stableElement as EsTreeNodeOfType<"AssignmentPattern">).left
      : (stableElement as EsTreeNode);
    return isNodeOfType(innerBinding, "Identifier") && symbol.bindingIdentifier === innerBinding;
  }
  return false;
};

const symbolHasUseEffectEventOrigin = (symbol: SymbolDescriptor): boolean => {
  const initializer = symbol.initializer ? unwrapExpression(symbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  return getHookName(initializer.callee) === "useEffectEvent";
};

const getFunctionValueNode = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (symbol.kind === "function" && isNodeOfType(symbol.declarationNode, "FunctionDeclaration")) {
    return symbol.declarationNode;
  }
  const initializer = symbol.initializer ? unwrapExpression(symbol.initializer) : null;
  if (
    initializer &&
    (isNodeOfType(initializer, "FunctionExpression") ||
      isNodeOfType(initializer, "ArrowFunctionExpression"))
  ) {
    return initializer;
  }
  return null;
};

const isAstDescendant = (inner: EsTreeNode, outer: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = inner;
  while (current) {
    if (current === outer) return true;
    current = current.parent ?? null;
  }
  return false;
};

const isRecursiveInitializerCapture = (symbol: SymbolDescriptor, callback: EsTreeNode): boolean => {
  const initializer = symbol.initializer;
  return Boolean(initializer && isAstDescendant(callback, initializer));
};

const symbolHasStableFunctionOrigin = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return true;
  const functionNode = getFunctionValueNode(symbol);
  if (!functionNode) return false;
  visitedSymbolIds.add(symbol.id);
  for (const reference of closureCaptures(functionNode, scopes)) {
    const capturedSymbol = reference.resolvedSymbol;
    if (!capturedSymbol) continue;
    if (capturedSymbol.id === symbol.id) continue;
    if (isOutsideAllFunctions(capturedSymbol)) continue;
    if (symbolHasStableValue(capturedSymbol, scopes, visitedSymbolIds)) continue;
    return false;
  }
  return true;
};

const symbolHasStableValue = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean =>
  symbolHasStableHookOrigin(symbol) ||
  symbolHasStableFunctionOrigin(symbol, scopes, visitedSymbolIds);

const getDestructuredPropertyPath = (pattern: EsTreeNode): string | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  const firstProperty = pattern.properties[0] as EsTreeNode | undefined;
  if (!firstProperty || !isNodeOfType(firstProperty, "Property")) return null;
  const key = firstProperty.key as EsTreeNode;
  const value = firstProperty.value as EsTreeNode;
  const keyName = isNodeOfType(key, "Identifier")
    ? key.name
    : isNodeOfType(key, "Literal") && typeof key.value === "string"
      ? key.value
      : null;
  if (!keyName) return null;
  const nestedPath = getDestructuredPropertyPath(value);
  return nestedPath ? `${keyName}.${nestedPath}` : keyName;
};

// Returns the bare identifier name of a captured reference, regardless
// of whether the reference came in via a JS `Identifier` or a
// `JSXIdentifier` (e.g. `<Component />`'s tag, which captures the
// component binding the same way `Component()` would).
const flattenReferenceRootName = (reference: ReferenceDescriptor): string => {
  const referencedIdentifier = reference.identifier;
  if (isNodeOfType(referencedIdentifier, "Identifier")) return referencedIdentifier.name;
  if (isNodeOfType(referencedIdentifier, "JSXIdentifier")) return referencedIdentifier.name;
  return "";
};

// Computes the dep "key" (root identifier name OR the full member-path)
// for a captured reference. e.g.:
//   reference points to `count`            → "count"
//   reference is `props` in `props.foo`    → "props.foo"
//   reference is `ref` in `ref.current`    → "ref" (`.current` access
//                                             doesn't add a dep)
const computeDepKey = (reference: ReferenceDescriptor): string => {
  const referencedIdentifier = reference.identifier;
  let parent = referencedIdentifier.parent ?? null;
  // Strip ChainExpression wrappers (a?.b parses to `ChainExpression {
  // expression: MemberExpression }`).
  if (parent && parent.type === "ChainExpression") {
    parent = parent.parent ?? null;
  }
  if (
    !parent ||
    !isNodeOfType(parent, "MemberExpression") ||
    parent.object !== referencedIdentifier
  ) {
    if (
      parent &&
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === referencedIdentifier
    ) {
      const destructuredPath = getDestructuredPropertyPath(parent.id);
      const rootName = flattenReferenceRootName(reference);
      if (destructuredPath && rootName) return `${rootName}.${destructuredPath}`;
    }
    return flattenReferenceRootName(reference);
  }
  // Walk up to the outermost MemberExpression (through any
  // ChainExpression wrappers in between).
  let outermost: EsTreeNode = parent;
  while (true) {
    const grandparent: EsTreeNode | null | undefined = outermost.parent;
    if (!grandparent) break;
    const isTransparentWrapper = TRANSPARENT_WRAPPER_TYPES.has(grandparent.type);
    const candidate: EsTreeNode | null | undefined = isTransparentWrapper
      ? (grandparent as { parent?: EsTreeNode | null }).parent
      : grandparent;
    const expectedObject: EsTreeNode = isTransparentWrapper ? grandparent : outermost;
    if (
      candidate &&
      isNodeOfType(candidate, "MemberExpression") &&
      candidate.object === expectedObject
    ) {
      outermost = candidate;
      continue;
    }
    break;
  }
  const fullName = stringifyMemberChain(outermost);
  if (fullName === null) return flattenReferenceRootName(reference);
  const declarator = outermost.parent;
  if (
    declarator &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.init === outermost
  ) {
    const destructuredPath = getDestructuredPropertyPath(declarator.id);
    if (destructuredPath) return `${fullName}.${destructuredPath}`;
  }
  if (reference.flag !== "read") {
    const lastDotIndex = fullName.lastIndexOf(".");
    if (lastDotIndex !== -1) return fullName.slice(0, lastDotIndex);
  }
  // Strip `.current` suffix for ref-like values; that property is
  // mutable but the ref itself is stable.
  const REF_CURRENT_SUFFIX = ".current";
  if (fullName.endsWith(REF_CURRENT_SUFFIX)) {
    return fullName.slice(0, -REF_CURRENT_SUFFIX.length);
  }
  return fullName;
};

// Strip TypeScript expression wrappers transparently — `(x as T)`,
// `x satisfies T`, `x!`, `(x)` — so they don't change the dep key.
const TRANSPARENT_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
  "ChainExpression",
]);

const unwrapExpression = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (TRANSPARENT_WRAPPER_TYPES.has(current.type)) {
    const inner = (current as { expression?: EsTreeNode | null }).expression;
    if (!inner) return current;
    current = inner;
  }
  return current;
};

const computeDeclaredDepKey = (entry: EsTreeNode): string | null => {
  const stripped = unwrapExpression(entry);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "MemberExpression")) {
    return stringifyMemberChain(stripped);
  }
  return null;
};

const depsArrayContainsIdentifier = (
  depsArgument: EsTreeNode | undefined,
  identifierName: string,
): boolean => {
  if (!depsArgument) return false;
  const strippedDepsArgument = unwrapExpression(depsArgument);
  if (!isNodeOfType(strippedDepsArgument, "ArrayExpression")) return false;
  return strippedDepsArgument.elements.some((element) => {
    if (!element) return false;
    const strippedElement = unwrapExpression(element as EsTreeNode);
    return isNodeOfType(strippedElement, "Identifier") && strippedElement.name === identifierName;
  });
};

const stringifyMemberChain = (node: EsTreeNode): string | null => {
  const stripped = unwrapExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "ThisExpression")) return "this";
  if (isNodeOfType(stripped, "MemberExpression")) {
    const objectName = stringifyMemberChain(stripped.object);
    if (objectName && stripped.computed) return objectName;
    if (objectName && !stripped.computed && isNodeOfType(stripped.property, "Identifier")) {
      return `${objectName}.${stripped.property.name}`;
    }
  }
  return null;
};

interface CaptureCollection {
  keys: Set<string>;
  // Names of bindings that the callback captured but that we filtered
  // out of `keys` because their value is structurally stable (literal
  // const, useState setter, useRef, useEffectEvent, module-scope).
  // These are valid-but-redundant deps — flagging them as unnecessary
  // would diverge from upstream's policy.
  stableCapturedNames: Set<string>;
}

// Walks captures grouping by "dep key" (the canonical name of the
// outermost member-expression chain).
const collectCaptureDepKeys = (callback: EsTreeNode, scopes: ScopeAnalysis): CaptureCollection => {
  const keys = new Set<string>();
  const stableCapturedNames = new Set<string>();
  const componentOrHookFunction = findEnclosingComponentOrHookFunction(callback);
  const componentOrHookScope = componentOrHookFunction
    ? scopes.ownScopeFor(componentOrHookFunction)
    : null;
  for (const reference of closureCaptures(callback, scopes)) {
    const symbol = reference.resolvedSymbol;
    if (!symbol) continue;
    if (isRecursiveInitializerCapture(symbol, callback)) continue;
    if (symbolHasStableValue(symbol, scopes)) {
      stableCapturedNames.add(symbol.name);
      continue;
    }
    // Skip bindings declared outside any function — they don't change
    // between renders, so React doesn't need them in deps. We do NOT
    // mark these as `stableCapturedNames` because module-scope values
    // (especially imports) can technically be mutated externally —
    // upstream still flags them as unnecessary if the user lists them
    // in deps.
    if (isOutsideAllFunctions(symbol)) continue;
    if (componentOrHookScope && !isDescendantScope(symbol.scope, componentOrHookScope)) continue;
    const depKey = computeDepKey(reference);
    if (!depKey) continue;
    keys.add(depKey);
  }
  const functionParams = (callback as { params?: ReadonlyArray<EsTreeNode> }).params ?? [];
  for (const param of functionParams) {
    if (!isNodeOfType(param, "AssignmentPattern")) continue;
    const visitDefaultValue = (node: EsTreeNode): void => {
      if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "MemberExpression")) {
        const depKey = stringifyMemberChain(node);
        if (depKey) keys.add(depKey);
      }
      const reference = scopes.referenceFor(node);
      if (reference?.resolvedSymbol) {
        const symbol = reference.resolvedSymbol;
        if (!isOutsideAllFunctions(symbol)) {
          const depKey = computeDepKey(reference);
          if (depKey) keys.add(depKey);
        }
      }
      const record = node as unknown as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key === "parent") continue;
        const child = record[key];
        if (Array.isArray(child)) {
          for (const item of child) if (isAstNode(item)) visitDefaultValue(item);
        } else if (isAstNode(child)) {
          visitDefaultValue(child);
        }
      }
    };
    visitDefaultValue(param.right as EsTreeNode);
  }
  return { keys, stableCapturedNames };
};

const FUNCTION_SCOPE_KINDS: ReadonlySet<string> = new Set(["function", "arrow-function", "method"]);

const isOutsideAllFunctions = (symbol: SymbolDescriptor): boolean => {
  let scope: SymbolDescriptor["scope"] | null = symbol.scope;
  while (scope) {
    if (FUNCTION_SCOPE_KINDS.has(scope.kind)) return false;
    if (scope.kind === "module") return true;
    scope = scope.parent ?? null;
  }
  return true;
};

const isLiteralOrEmptyTemplate = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") ||
  (isNodeOfType(node, "TemplateLiteral") && getStaticTemplateLiteralValue(node) !== null);

const isNonStringLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value !== "string";

const isMatchingDepOrPrefix = (declaredKey: string, captureKey: string): boolean =>
  captureKey === declaredKey || captureKey.startsWith(`${declaredKey}.`);

const hasBroaderDeclaredDependency = (
  declaredKey: string,
  declaredKeys: ReadonlySet<string>,
): boolean => {
  for (const otherDeclaredKey of declaredKeys) {
    if (otherDeclaredKey !== declaredKey && declaredKey.startsWith(`${otherDeclaredKey}.`)) {
      return true;
    }
  }
  return false;
};

const getMemberRootIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  const stripped = unwrapExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped;
  if (isNodeOfType(stripped, "MemberExpression")) return getMemberRootIdentifier(stripped.object);
  return null;
};

const hasComputedMemberExpression = (node: EsTreeNode): boolean => {
  const stripped = unwrapExpression(node);
  if (!isNodeOfType(stripped, "MemberExpression")) return false;
  if (stripped.computed) return true;
  return hasComputedMemberExpression(stripped.object);
};

const isExtraEffectDepAllowed = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const rootIdentifier = getMemberRootIdentifier(node);
  if (!rootIdentifier) return false;
  const symbol = scopes.symbolFor(rootIdentifier);
  return Boolean(symbol && !isOutsideAllFunctions(symbol));
};

const getRootSymbol = (node: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  const rootIdentifier = getMemberRootIdentifier(node);
  return rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
};

const isRegExpLiteral = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "Literal")) return false;
  return Boolean((node as { regex?: unknown }).regex);
};

const isUnstableInitializer = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  const stripped = unwrapExpression(node);
  if (isRegExpLiteral(stripped)) return true;
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return isUnstableInitializer(stripped.consequent) || isUnstableInitializer(stripped.alternate);
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return isUnstableInitializer(stripped.left) || isUnstableInitializer(stripped.right);
  }
  return (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ClassExpression") ||
    isNodeOfType(stripped, "ClassDeclaration") ||
    isNodeOfType(stripped, "JSXElement") ||
    isNodeOfType(stripped, "JSXFragment") ||
    isNodeOfType(stripped, "AssignmentExpression") ||
    isNodeOfType(stripped, "NewExpression")
  );
};

const hasDirectIdentifierDeclarator = (symbol: SymbolDescriptor): boolean =>
  (isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(symbol.declarationNode.id, "Identifier")) ||
  isNodeOfType(symbol.declarationNode, "ClassDeclaration");

const isFunctionValueSymbol = (symbol: SymbolDescriptor): boolean =>
  getFunctionValueNode(symbol) !== null;

const isStableSetterLikeSymbol = (symbol: SymbolDescriptor): boolean => {
  if (!symbolHasStableHookOrigin(symbol)) return false;
  return (
    symbol.name.startsWith("set") ||
    symbol.name.startsWith("dispatch") ||
    symbol.name.startsWith("startTransition")
  );
};

const findStableSetterReference = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  let setterName: string | null = null;
  const visit = (current: EsTreeNode): void => {
    if (setterName) return;
    if (
      current !== node &&
      (isNodeOfType(current, "FunctionDeclaration") ||
        isNodeOfType(current, "FunctionExpression") ||
        isNodeOfType(current, "ArrowFunctionExpression"))
    ) {
      return;
    }
    if (isNodeOfType(current, "Identifier")) {
      const reference = scopes.referenceFor(current);
      const symbol = reference?.resolvedSymbol;
      if (symbol && isStableSetterLikeSymbol(symbol)) {
        setterName = symbol.name;
        return;
      }
    }
    const record = current as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(node);
  return setterName;
};

const collectOuterAssignments = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<{ name: string; node: EsTreeNode }> => {
  const callbackScope = scopes.ownScopeFor(callback) ?? scopes.scopeFor(callback);
  const assignments: Array<{ name: string; node: EsTreeNode }> = [];
  const seenNames = new Set<string>();
  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "Identifier")) {
      const symbol = scopes.symbolFor(node.left);
      if (
        symbol &&
        !seenNames.has(symbol.name) &&
        !isOutsideAllFunctions(symbol) &&
        !isDescendantScope(symbol.scope, callbackScope)
      ) {
        seenNames.add(symbol.name);
        assignments.push({ name: symbol.name, node: node.left });
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(callback);
  return assignments;
};

const getRefCurrentNameFromMemberExpression = (node: EsTreeNode): string | null => {
  const chain = stringifyMemberChain(node);
  if (!chain) return null;
  const currentIndex = chain.indexOf(".current");
  return currentIndex === -1 ? null : chain.slice(0, currentIndex + ".current".length);
};

const findRefCurrentInCleanup = (callback: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  let cleanupFunction: EsTreeNode | null = null;
  const findReturn = (node: EsTreeNode): void => {
    if (cleanupFunction) return;
    if (
      node !== callback &&
      (isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "ArrowFunctionExpression"))
    ) {
      return;
    }
    if (isNodeOfType(node, "ReturnStatement")) {
      const argument = node.argument as EsTreeNode | null;
      if (
        argument &&
        (isNodeOfType(argument, "FunctionExpression") ||
          isNodeOfType(argument, "ArrowFunctionExpression"))
      ) {
        cleanupFunction = argument;
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) findReturn(item);
      } else if (isAstNode(child)) {
        findReturn(child);
      }
    }
  };
  findReturn(callback);
  if (!cleanupFunction) return null;

  let refCurrentName: string | null = null;
  const visitCleanup = (node: EsTreeNode): void => {
    if (refCurrentName) return;
    if (isNodeOfType(node, "MemberExpression")) {
      const candidateName = getRefCurrentNameFromMemberExpression(node);
      if (candidateName) {
        const rootIdentifier = getMemberRootIdentifier(node);
        const symbol = rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
        const callbackScope = scopes.ownScopeFor(callback) ?? scopes.scopeFor(callback);
        if (!symbol || !isDescendantScope(symbol.scope, callbackScope)) {
          refCurrentName = candidateName;
          return;
        }
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visitCleanup(item);
      } else if (isAstNode(child)) {
        visitCleanup(child);
      }
    }
  };
  visitCleanup(cleanupFunction);
  return refCurrentName;
};

const hasRefCurrentAssignment = (callback: EsTreeNode, refCurrentName: string): boolean => {
  let didAssignRefCurrent = false;
  const visit = (node: EsTreeNode): void => {
    if (didAssignRefCurrent) return;
    if (
      node !== callback &&
      (isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "ArrowFunctionExpression"))
    ) {
      return;
    }
    if (isNodeOfType(node, "AssignmentExpression")) {
      const leftName = getRefCurrentNameFromMemberExpression(node.left);
      if (leftName === refCurrentName) {
        didAssignRefCurrent = true;
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(callback);
  return didAssignRefCurrent;
};

const isOuterFunctionScopeDep = (
  node: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const rootIdentifier = getMemberRootIdentifier(node);
  if (!rootIdentifier) return false;
  const symbol = scopes.symbolFor(rootIdentifier);
  if (!symbol || isOutsideAllFunctions(symbol)) return false;
  const componentOrHookFunction = findEnclosingComponentOrHookFunction(callback);
  const componentOrHookScope = componentOrHookFunction
    ? scopes.ownScopeFor(componentOrHookFunction)
    : null;
  return Boolean(componentOrHookScope && !isDescendantScope(symbol.scope, componentOrHookScope));
};

const hasMemberCallForRoot = (node: EsTreeNode, rootName: string): boolean => {
  let didFindMemberCall = false;
  const visit = (current: EsTreeNode): void => {
    if (didFindMemberCall) return;
    if (isNodeOfType(current, "CallExpression")) {
      const callee = unwrapExpression(current.callee);
      const rootIdentifier = getMemberRootIdentifier(callee);
      if (rootIdentifier?.name === rootName) {
        didFindMemberCall = true;
        return;
      }
    }
    const record = current as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(node);
  return didFindMemberCall;
};

const addAggregatePropsDependency = (
  captureKeys: Set<string>,
  declaredKeys: ReadonlySet<string>,
  callback: EsTreeNode,
): void => {
  const propsCaptureCount = [...captureKeys].filter((captureKey) =>
    captureKey.startsWith("props."),
  ).length;
  if (propsCaptureCount < 2 || declaredKeys.has("props")) return;
  if (hasMemberCallForRoot(callback, "props")) captureKeys.add("props");
};

export const exhaustiveDeps = defineRule<Rule>({
  id: "exhaustive-deps",
  severity: "warn",
  tags: ["test-noise"],
  recommendation: "List every value the hook callback captures in its dependency array.",
  category: "Correctness",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const additionalHooksRegex = buildAdditionalHooksRegex(settings.additionalHooks);
    const isHookOfInterest = (hookName: string, callee: EsTreeNode): boolean => {
      if (HOOKS_REQUIRING_DEPS_MATCH.has(hookName)) return true;
      if (
        additionalHooksRegex &&
        isNodeOfType(callee, "Identifier") &&
        additionalHooksRegex.test(hookName)
      ) {
        return true;
      }
      return false;
    };
    const isAutoDependenciesHook = (hookName: string): boolean =>
      settings.experimental_autoDependenciesHooks.includes(hookName);

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const hookName = getHookName(node.callee);
        if (!hookName || !isHookOfInterest(hookName, node.callee)) return;

        const callbackArgumentIndex = getCallbackArgumentIndex(hookName);
        const depsArgumentIndex = getDepsArgumentIndex(hookName);
        const callbackArgument = node.arguments[callbackArgumentIndex];
        if (!callbackArgument) {
          context.report({ node, message: buildMissingCallbackMessage(hookName) });
          return;
        }
        const depsArgumentRaw = node.arguments[depsArgumentIndex];
        const callbackExpression = unwrapExpression(callbackArgument as EsTreeNode);
        let callbackToAnalyze: EsTreeNode | null = null;
        const forcedCaptureKeys = new Set<string>();
        if (
          isNodeOfType(callbackExpression, "ArrowFunctionExpression") ||
          isNodeOfType(callbackExpression, "FunctionExpression")
        ) {
          callbackToAnalyze = callbackExpression;
        } else if (isNodeOfType(callbackExpression, "Identifier")) {
          const callbackSymbol = context.scopes.symbolFor(callbackExpression);
          const functionValueNode = callbackSymbol ? getFunctionValueNode(callbackSymbol) : null;
          if (functionValueNode) {
            callbackToAnalyze = functionValueNode;
          } else if (
            callbackSymbol?.initializer &&
            isNodeOfType(unwrapExpression(callbackSymbol.initializer), "CallExpression")
          ) {
            forcedCaptureKeys.add(callbackExpression.name);
          } else if (depsArgumentRaw) {
            if (
              depsArrayContainsIdentifier(depsArgumentRaw as EsTreeNode, callbackExpression.name)
            ) {
              return;
            }
            context.report({
              node: callbackExpression,
              message: buildUnknownCallbackMessage(hookName),
            });
            return;
          }
        } else if (depsArgumentRaw) {
          context.report({
            node: callbackArgument as EsTreeNode,
            message: buildUnknownCallbackMessage(hookName),
          });
          return;
        } else {
          // Callback that isn't a function literal (e.g. a passed
          // variable) — can't statically analyze its closure. We
          // still flag missing deps for hooks that require them.
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName) && !node.arguments[depsArgumentIndex]) {
            context.report({ node, message: buildMissingDepArrayMessage(hookName) });
          }
          return;
        }
        if (
          callbackToAnalyze &&
          (isNodeOfType(callbackToAnalyze, "ArrowFunctionExpression") ||
            isNodeOfType(callbackToAnalyze, "FunctionExpression")) &&
          callbackToAnalyze.async &&
          (EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName) || hookName === "useEffect")
        ) {
          context.report({ node: callbackArgument, message: buildAsyncEffectMessage(hookName) });
        }
        if (callbackToAnalyze) {
          const outerAssignments = collectOuterAssignments(callbackToAnalyze, context.scopes);
          for (const assignment of outerAssignments) {
            context.report({
              node: assignment.node,
              message: buildAssignmentMessage(assignment.name),
            });
          }
          if (outerAssignments.length > 0) return;
          const refCurrentName = findRefCurrentInCleanup(callbackToAnalyze, context.scopes);
          const shouldCheckRefCleanup =
            EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName) ||
            Boolean(additionalHooksRegex && additionalHooksRegex.test(hookName));
          if (
            refCurrentName &&
            shouldCheckRefCleanup &&
            !hasRefCurrentAssignment(callbackToAnalyze, refCurrentName)
          ) {
            context.report({
              node: callbackToAnalyze,
              message: buildRefCleanupMessage(refCurrentName),
            });
          }
        }

        if (!depsArgumentRaw) {
          if (callbackToAnalyze && EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName)) {
            const setterName = findStableSetterReference(callbackToAnalyze, context.scopes);
            if (setterName) {
              context.report({
                node: callbackToAnalyze,
                message: buildSetStateWithoutDepsMessage(hookName, setterName),
              });
              return;
            }
          }
          if (
            HOOKS_REQUIRING_DEPS_ARRAY.has(hookName) ||
            (settings.requireExplicitEffectDeps && HOOKS_REQUIRING_DEPS_MATCH.has(hookName))
          ) {
            context.report({ node, message: buildMissingDepArrayMessage(hookName) });
          }
          return;
        }

        // null / undefined deps argument → treat as "no deps". Upstream
        // tolerates these as "intentional no-deps" for useEffect-style
        // hooks but flags them for hooks that require deps.
        const depsArgument = unwrapExpression(depsArgumentRaw as EsTreeNode);
        if (
          (isNodeOfType(depsArgument, "Literal") && depsArgument.value === null) ||
          (isNodeOfType(depsArgument, "Identifier") && depsArgument.name === "undefined")
        ) {
          if (isAutoDependenciesHook(hookName)) return;
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName)) {
            context.report({
              node: depsArgument,
              message: buildMissingDepArrayMessage(hookName),
            });
            return;
          }
          const nonArrayCaptureKeys =
            callbackToAnalyze !== null
              ? new Set(collectCaptureDepKeys(callbackToAnalyze, context.scopes).keys)
              : new Set<string>();
          for (const forcedCaptureKey of forcedCaptureKeys)
            nonArrayCaptureKeys.add(forcedCaptureKey);
          if (nonArrayCaptureKeys.size > 0) {
            context.report({ node: depsArgument, message: buildNonArrayDepsMessage(hookName) });
            context.report({
              node: depsArgument,
              message: buildMissingDepMessage(hookName, [...nonArrayCaptureKeys].join(", ")),
            });
          }
          return;
        }

        if (!isNodeOfType(depsArgument, "ArrayExpression")) {
          context.report({ node: depsArgument, message: buildNonArrayDepsMessage(hookName) });
          const nonArrayCaptureKeys =
            callbackToAnalyze !== null
              ? new Set(collectCaptureDepKeys(callbackToAnalyze, context.scopes).keys)
              : new Set<string>();
          for (const forcedCaptureKey of forcedCaptureKeys)
            nonArrayCaptureKeys.add(forcedCaptureKey);
          if (nonArrayCaptureKeys.size > 0) {
            context.report({
              node: depsArgument,
              message: buildMissingDepMessage(hookName, [...nonArrayCaptureKeys].join(", ")),
            });
          }
          return;
        }

        const { keys: captureKeys, stableCapturedNames } = collectCaptureDepKeys(
          callbackToAnalyze ?? callbackArgument,
          context.scopes,
        );
        for (const forcedCaptureKey of forcedCaptureKeys) captureKeys.add(forcedCaptureKey);

        // Pre-scan: emit a single "literal deps" warning when the
        // deps array contains a non-string-literal value (numeric /
        // boolean / null / bigint). String-literal deps are usually
        // typos of an identifier ("foo" → foo) and upstream emits
        // those via the missing-dep message's hint instead of an
        // extra summary warning, so we suppress this summary when
        // every literal in the array is a string.
        const hasLiteralDepElement = depsArgument.elements.some((element) => {
          if (!element) return false;
          return isLiteralOrEmptyTemplate(unwrapExpression(element as EsTreeNode));
        });
        const hasNonStringLiteralDep = depsArgument.elements.some((element) => {
          if (!element) return false;
          return isNonStringLiteral(unwrapExpression(element as EsTreeNode));
        });
        if (hasNonStringLiteralDep) {
          context.report({ node: depsArgument, message: buildLiteralDepMessage(hookName) });
        }

        const declaredKeys = new Set<string>();
        const declaredKeyToReportNode = new Map<string, EsTreeNode>();
        const seenDeclaredKeys = new Set<string>();
        let didReportRefCurrentDep = false;
        let didReportDuplicateDep = false;
        for (const element of depsArgument.elements) {
          if (!element) continue;
          const elementNode = element as EsTreeNode;
          if (isNodeOfType(elementNode, "SpreadElement")) {
            context.report({ node: elementNode, message: buildSpreadDepMessage(hookName) });
            continue;
          }
          const stripped = unwrapExpression(elementNode);

          if (isLiteralOrEmptyTemplate(stripped)) continue;

          if (isNodeOfType(stripped, "Identifier")) {
            const depSymbol = context.scopes.symbolFor(stripped);
            if (depSymbol && symbolHasUseEffectEventOrigin(depSymbol)) {
              context.report({
                node: elementNode,
                message: buildEffectEventDepMessage(stripped.name),
              });
              continue;
            }
          }

          // Detect `<ref>.current` in deps where `<ref>` is a useRef
          // binding — upstream's "depend on the ref itself, not its
          // mutable .current" warning.
          const fullChain = stringifyMemberChain(stripped);
          if (
            fullChain &&
            fullChain.endsWith(".current") &&
            isNodeOfType(stripped, "MemberExpression") &&
            isNodeOfType(stripped.object, "Identifier")
          ) {
            const refSymbol = context.scopes.symbolFor(stripped.object);
            if (refSymbol && symbolHasStableHookOrigin(refSymbol)) {
              if (!didReportRefCurrentDep) {
                context.report({
                  node: elementNode,
                  message: buildRefCurrentDepMessage(hookName, fullChain),
                });
                didReportRefCurrentDep = true;
              }
              continue;
            }
          }

          const key = computeDeclaredDepKey(elementNode);
          if (key === null) {
            context.report({ node: elementNode, message: buildComplexDepMessage(hookName) });
            continue;
          }
          if (hasComputedMemberExpression(stripped)) {
            context.report({ node: elementNode, message: buildComplexDepMessage(hookName) });
            continue;
          }
          if (seenDeclaredKeys.has(key)) {
            context.report({
              node: elementNode,
              message: buildDuplicateDepMessage(hookName, key),
            });
            didReportDuplicateDep = true;
            continue;
          }
          seenDeclaredKeys.add(key);
          declaredKeys.add(key);
          declaredKeyToReportNode.set(key, elementNode);
        }
        addAggregatePropsDependency(
          captureKeys,
          declaredKeys,
          callbackToAnalyze ?? callbackArgument,
        );

        const missingCaptureKeys: string[] = [];
        for (const captureKey of captureKeys) {
          let isCoveredByDeclared = false;
          for (const declaredKey of declaredKeys) {
            if (isMatchingDepOrPrefix(declaredKey, captureKey)) {
              isCoveredByDeclared = true;
              break;
            }
          }
          if (isCoveredByDeclared) continue;
          missingCaptureKeys.push(captureKey);
        }
        const shouldGroupMissingDeps = !hasLiteralDepElement;
        if (missingCaptureKeys.length > 0 && shouldGroupMissingDeps) {
          context.report({
            node: depsArgument,
            message: buildMissingDepMessage(hookName, missingCaptureKeys.join(", ")),
          });
        } else {
          for (const missingCaptureKey of missingCaptureKeys) {
            context.report({
              node: depsArgument,
              message: buildMissingDepMessage(hookName, missingCaptureKey),
            });
          }
        }
        if (missingCaptureKeys.length === 0 && hasLiteralDepElement && !hasNonStringLiteralDep) {
          context.report({ node: depsArgument, message: buildLiteralDepMessage(hookName) });
        }

        for (const declaredKey of declaredKeys) {
          if (declaredKey.includes(".")) continue;
          const reportNode = declaredKeyToReportNode.get(declaredKey) ?? depsArgument;
          const rootSymbol = getRootSymbol(reportNode, context.scopes);
          if (
            !rootSymbol ||
            !isFunctionValueSymbol(rootSymbol) ||
            isRecursiveInitializerCapture(rootSymbol, callbackToAnalyze ?? callbackArgument)
          ) {
            continue;
          }
          context.report({
            node: reportNode,
            message: buildUnstableDepMessage(hookName, declaredKey),
          });
        }

        let hasUnusedDeclaredDep = false;
        const unnecessaryDeclaredKeys: string[] = [];
        let unnecessaryReportNode: EsTreeNode = depsArgument;
        for (const declaredKey of declaredKeys) {
          let isUsed = false;
          for (const captureKey of captureKeys) {
            if (isMatchingDepOrPrefix(declaredKey, captureKey)) {
              isUsed = true;
              break;
            }
          }
          if (!isUsed && !stableCapturedNames.has(declaredKey)) {
            hasUnusedDeclaredDep = true;
            break;
          }
        }

        let didReportUnstableDep = false;
        for (const declaredKey of declaredKeys) {
          if (
            missingCaptureKeys.length > 0 ||
            hasUnusedDeclaredDep ||
            didReportDuplicateDep ||
            didReportUnstableDep ||
            declaredKey.includes(".")
          ) {
            continue;
          }
          let isUsed = false;
          for (const captureKey of captureKeys) {
            if (isMatchingDepOrPrefix(declaredKey, captureKey)) {
              isUsed = true;
              break;
            }
          }
          if (!isUsed && stableCapturedNames.has(declaredKey)) isUsed = true;
          if (!isUsed) continue;
          const reportNode = declaredKeyToReportNode.get(declaredKey) ?? depsArgument;
          const rootSymbol = getRootSymbol(reportNode, context.scopes);
          if (
            !rootSymbol ||
            !hasDirectIdentifierDeclarator(rootSymbol) ||
            !isUnstableInitializer(rootSymbol.initializer)
          ) {
            continue;
          }
          context.report({
            node: reportNode,
            message: buildUnstableDepMessage(hookName, declaredKey),
          });
          didReportUnstableDep = true;
        }

        // Unnecessary: declared but not captured. We suppress the
        // report ONLY when the binding was filtered out of captureKeys
        // for being structurally stable (literal-typed local const,
        // useState setter, useRef, useEffectEvent). Other "captured by
        // name but at a different chain depth" mismatches (e.g. declared
        // `local.id` while the callback captures `local`) are real
        // redundancies and we flag them.
        for (const declaredKey of declaredKeys) {
          let isUsed = false;
          for (const captureKey of captureKeys) {
            if (isMatchingDepOrPrefix(declaredKey, captureKey)) {
              isUsed = true;
              break;
            }
          }
          if (missingCaptureKeys.length > 0) continue;
          if (
            isUsed &&
            !EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName) &&
            hasBroaderDeclaredDependency(declaredKey, declaredKeys)
          ) {
            const reportNode = declaredKeyToReportNode.get(declaredKey) ?? depsArgument;
            unnecessaryDeclaredKeys.push(declaredKey);
            unnecessaryReportNode = reportNode;
            continue;
          }
          if (isUsed) continue;
          if (didReportRefCurrentDep) continue;
          const rootName = declaredKey.split(".")[0]!;
          if (stableCapturedNames.has(rootName)) continue;
          const reportNode = declaredKeyToReportNode.get(declaredKey) ?? depsArgument;
          if (
            EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName) &&
            isExtraEffectDepAllowed(reportNode, context.scopes)
          ) {
            continue;
          }
          if (
            missingCaptureKeys.length > 0 &&
            isOuterFunctionScopeDep(
              reportNode,
              callbackToAnalyze ?? callbackArgument,
              context.scopes,
            )
          ) {
            continue;
          }
          const rootSymbol = getRootSymbol(reportNode, context.scopes);
          if (
            rootSymbol &&
            missingCaptureKeys.length > 0 &&
            isRecursiveInitializerCapture(rootSymbol, callbackToAnalyze ?? callbackArgument)
          ) {
            continue;
          }
          unnecessaryDeclaredKeys.push(declaredKey);
          unnecessaryReportNode = reportNode;
        }
        if (unnecessaryDeclaredKeys.length > 0) {
          context.report({
            node: unnecessaryReportNode,
            message: buildUnnecessaryDepMessage(hookName, unnecessaryDeclaredKeys.join(", ")),
          });
        }
      },
    };
  },
});
