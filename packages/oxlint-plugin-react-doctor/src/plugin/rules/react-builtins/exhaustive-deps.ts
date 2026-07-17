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
import { findForwardedFreshHookDependencies } from "../../utils/find-forwarded-fresh-hook-dependencies.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHocCallbackArgument } from "../../utils/is-react-hoc-callback-argument.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { EFFECT_HOOK_NAMES, REACT_HOC_NAMES } from "../../constants/react.js";
import {
  getHookName,
  isOutsideAllFunctions,
  TRANSPARENT_WRAPPER_TYPES,
  unwrapExpression,
} from "./exhaustive-deps-low-level.js";
import {
  buildAssignmentMessage,
  buildAsyncEffectMessage,
  buildComplexDepMessage,
  buildDuplicateDepMessage,
  buildEffectEventDepMessage,
  buildForwardedUnstableDepMessage,
  buildLiteralDepMessage,
  buildMissingCallbackMessage,
  buildMissingDepArrayMessage,
  buildMissingDepMessage,
  buildModuleScopeDepMessage,
  buildNonArrayDepsMessage,
  buildRefCleanupMessage,
  buildRefCurrentDepMessage,
  buildSetStateWithoutDepsMessage,
  buildSpreadDepMessage,
  buildUnknownCallbackMessage,
  buildUnnecessaryDepMessage,
  buildUnstableDepMessage,
} from "./exhaustive-deps-messages.js";
import { resolveExhaustiveDepsSettings } from "./exhaustive-deps-settings.js";
import { isSoleWriterEffectGuardCapture } from "./exhaustive-deps-sole-writer-guard.js";
import { isExhaustiveDepsSuppressedAt } from "./exhaustive-deps-suppression.js";
import {
  getFunctionValueNode,
  isRecursiveInitializerCapture,
  isStableRefContainerCapture,
  symbolHasStableHookOrigin,
  symbolHasStableValue,
} from "./exhaustive-deps-symbol-stability.js";
import { symbolHasReactUseEffectEventOrigin } from "../../utils/symbol-has-react-use-effect-event-origin.js";

// Port of `oxc_linter::rules::react::exhaustive_deps`. Diffs the
// closure-captured set of an effect / memo callback against its
// declared dependency array. Built on top of Phase A's scope analyzer
// and Phase C's closure-capture helper.

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

const SOLE_WRITER_GUARD_HOOKS: ReadonlySet<string> = new Set(["useEffect", "useLayoutEffect"]);

const buildAdditionalHooksRegex = (additional: string): RegExp | null => {
  if (!additional) return null;
  try {
    return new RegExp(additional);
  } catch {
    return null;
  }
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
      if (isReactHocCallbackArgument(current)) return current;
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

// Cuts a member-chain dep key at its `.current` segment: `.current` is
// a mutable ref cell, so anything read through it can't be a dependency
// — the ref itself is the dependable value (upstream truncates
// `props.someOtherRefs.current.innerHTML` to `props.someOtherRefs` the
// same way, even when the ref isn't a local `useRef`).
const REF_CURRENT_SEGMENT = ".current";
const truncateAtRefCurrent = (chain: string): string => {
  const refCurrentIndex = chain.indexOf(REF_CURRENT_SEGMENT);
  if (refCurrentIndex === -1) return chain;
  const segmentEndIndex = refCurrentIndex + REF_CURRENT_SEGMENT.length;
  if (segmentEndIndex === chain.length || chain[segmentEndIndex] === ".") {
    return chain.slice(0, refCurrentIndex);
  }
  return chain;
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
    if (destructuredPath) return truncateAtRefCurrent(`${fullName}.${destructuredPath}`);
  }
  const truncatedName = truncateAtRefCurrent(fullName);
  if (truncatedName !== fullName) return truncatedName;
  if (reference.flag !== "read") {
    const lastDotIndex = fullName.lastIndexOf(".");
    if (lastDotIndex !== -1) return fullName.slice(0, lastDotIndex);
  }
  return fullName;
};

const computeDeclaredDepKey = (entry: EsTreeNode): string | null => {
  const stripped = unwrapExpression(entry);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "MemberExpression")) {
    return stringifyMemberChain(stripped);
  }
  // Solid-style accessor call in deps: key a zero-arg `foo()` / `foo.bar()`
  // off its callee, matching how `computeDepKey` keys the captured accessor
  // (by callee, not the CallExpression), so a listed accessor call matches
  // the capture instead of being dropped as a complex dep. A computed
  // member anywhere in the callee (`items[index]()`) is a dynamic
  // per-render lookup — `stringifyMemberChain` would collapse it to the
  // root name and silently satisfy that capture, so it stays a complex dep.
  if (isNodeOfType(stripped, "CallExpression") && (stripped.arguments?.length ?? 0) === 0) {
    const callee = unwrapExpression(stripped.callee);
    if (isNodeOfType(callee, "Identifier")) return callee.name;
    if (isNodeOfType(callee, "MemberExpression") && !hasComputedMemberExpression(callee)) {
      return stringifyMemberChain(callee);
    }
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
  // Module-scope bindings the callback actually reads. Listing one in
  // deps is still redundant (upstream policy), but the report must not
  // claim the callback "never uses it".
  moduleScopeCapturedNames: Set<string>;
  // Bindings the callback reads from a function scope OUTSIDE the
  // nearest component/hook function (e.g. a custom hook nested inside
  // another custom hook reading the outer hook's parameter). They are
  // excluded from the required-deps diff, but the callback DOES read
  // them — an "unnecessary, never uses it" report would be factually
  // wrong.
  outerFunctionCapturedNames: Set<string>;
}

// Walks captures grouping by "dep key" (the canonical name of the
// outermost member-expression chain).
const collectCaptureDepKeys = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  declaredExactBindingKeys?: ReadonlySet<string>,
  allowSoleWriterEffectGuards = false,
): CaptureCollection => {
  const keys = new Set<string>();
  const stableCapturedNames = new Set<string>();
  const moduleScopeCapturedNames = new Set<string>();
  const outerFunctionCapturedNames = new Set<string>();
  const componentOrHookFunction = findEnclosingComponentOrHookFunction(callback);
  const componentOrHookScope = componentOrHookFunction
    ? scopes.ownScopeFor(componentOrHookFunction)
    : null;
  for (const reference of closureCaptures(callback, scopes)) {
    const symbol = reference.resolvedSymbol;
    if (!symbol) continue;
    if (isRecursiveInitializerCapture(symbol, callback)) continue;
    if (allowSoleWriterEffectGuards && isSoleWriterEffectGuardCapture(symbol, callback, scopes)) {
      stableCapturedNames.add(symbol.name);
      continue;
    }
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
    if (isOutsideAllFunctions(symbol)) {
      moduleScopeCapturedNames.add(symbol.name);
      continue;
    }
    if (componentOrHookScope && !isDescendantScope(symbol.scope, componentOrHookScope)) {
      outerFunctionCapturedNames.add(symbol.name);
      continue;
    }
    const depKey = computeDepKey(reference);
    if (!depKey) continue;
    if (isStableRefContainerCapture(symbol, depKey, scopes)) {
      stableCapturedNames.add(depKey);
      continue;
    }
    if (depKey === symbol.name) {
      if (declaredExactBindingKeys?.has(depKey)) {
        keys.add(depKey);
        continue;
      }
      const identitySourceKeys =
        resolvePureCalledFunctionSourceKeys(reference, symbol, scopes) ??
        resolveRenderDerivedMutableSourceKeys(reference, symbol, scopes) ??
        resolveReactiveIdentitySourceKeys(symbol, scopes);
      if (identitySourceKeys) {
        if (identitySourceKeys.size === 0) stableCapturedNames.add(depKey);
        for (const identitySourceKey of identitySourceKeys) keys.add(identitySourceKey);
        continue;
      }
    }
    keys.add(depKey);
  }
  // Parameter default values and computed destructuring keys are now
  // recorded as references by the scope analyzer, so `closureCaptures`
  // already collects them through the SAME filtered path as the body
  // above (module-scope / stable values excluded). A separate manual
  // param walk used to live here and added every default-value name
  // unconditionally — which mis-reported module constants like
  // `(opts = SOME_CONST) => …` as missing deps.
  return { keys, stableCapturedNames, moduleScopeCapturedNames, outerFunctionCapturedNames };
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

const mergeIdentitySourceKeys = (
  expressions: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): Set<string> | null => {
  const identitySourceKeys = new Set<string>();
  for (const expression of expressions) {
    const expressionSourceKeys = resolveIdentitySourceKeysFromExpression(
      expression,
      scopes,
      visitedSymbolIds,
    );
    if (!expressionSourceKeys) return null;
    for (const expressionSourceKey of expressionSourceKeys) {
      identitySourceKeys.add(expressionSourceKey);
    }
  }
  return identitySourceKeys;
};

const resolveIdentitySourceKeysFromExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): Set<string> | null => {
  const stripped = unwrapExpression(expression);
  if (
    (isNodeOfType(stripped, "Literal") &&
      (stripped.value === null ||
        typeof stripped.value === "string" ||
        typeof stripped.value === "number" ||
        typeof stripped.value === "boolean")) ||
    (isNodeOfType(stripped, "TemplateLiteral") && getStaticTemplateLiteralValue(stripped) !== null)
  ) {
    return new Set();
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const sourceSymbol = scopes.symbolFor(stripped);
    if (!sourceSymbol) return null;
    if (isOutsideAllFunctions(sourceSymbol) || symbolHasStableValue(sourceSymbol, scopes)) {
      return new Set();
    }
    if (
      sourceSymbol.kind === "const" &&
      sourceSymbol.initializer &&
      isNodeOfType(sourceSymbol.declarationNode, "VariableDeclarator") &&
      sourceSymbol.declarationNode.id === sourceSymbol.bindingIdentifier &&
      sourceSymbol.references.every((reference) => reference.flag === "read")
    ) {
      if (visitedSymbolIds.has(sourceSymbol.id)) return null;
      visitedSymbolIds.add(sourceSymbol.id);
      const sourceKeys = resolveIdentitySourceKeysFromExpression(
        sourceSymbol.initializer,
        scopes,
        visitedSymbolIds,
      );
      visitedSymbolIds.delete(sourceSymbol.id);
      if (sourceKeys) return sourceKeys;
    }
    return new Set([sourceSymbol.name]);
  }
  if (isNodeOfType(stripped, "MemberExpression")) {
    if (hasComputedMemberExpression(stripped)) return null;
    const sourceKey = stringifyMemberChain(stripped);
    const rootIdentifier = getMemberRootIdentifier(stripped);
    const rootSymbol = rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
    if (!sourceKey || !rootSymbol) return null;
    if (isOutsideAllFunctions(rootSymbol)) return new Set();
    if (isStableRefContainerCapture(rootSymbol, sourceKey, scopes)) return new Set();
    if (symbolHasStableValue(rootSymbol, scopes)) return new Set();
    return new Set([sourceKey]);
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return mergeIdentitySourceKeys([stripped.left, stripped.right], scopes, visitedSymbolIds);
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return mergeIdentitySourceKeys(
      [stripped.test, stripped.consequent, stripped.alternate],
      scopes,
      visitedSymbolIds,
    );
  }
  return null;
};

const resolveReactiveIdentitySourceKeys = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): Set<string> | null => {
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  return resolveIdentitySourceKeysFromExpression(symbol.initializer, scopes, new Set([symbol.id]));
};

const isPureDerivedExpression = (expression: EsTreeNode): boolean => {
  const candidate = unwrapExpression(expression);
  if (isNodeOfType(candidate, "Literal") || isNodeOfType(candidate, "Identifier")) return true;
  if (isNodeOfType(candidate, "MemberExpression")) {
    return (
      isPureDerivedExpression(candidate.object) &&
      (!candidate.computed || isPureDerivedExpression(candidate.property))
    );
  }
  if (isNodeOfType(candidate, "BinaryExpression") || isNodeOfType(candidate, "LogicalExpression")) {
    return isPureDerivedExpression(candidate.left) && isPureDerivedExpression(candidate.right);
  }
  if (isNodeOfType(candidate, "UnaryExpression")) {
    return candidate.operator !== "delete" && isPureDerivedExpression(candidate.argument);
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      isPureDerivedExpression(candidate.test) &&
      isPureDerivedExpression(candidate.consequent) &&
      isPureDerivedExpression(candidate.alternate)
    );
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return candidate.expressions.every((nestedExpression) =>
      isPureDerivedExpression(nestedExpression),
    );
  }
  return false;
};

const isPureDerivedStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "BlockStatement")) {
    return statement.body.every((nestedStatement) => isPureDerivedStatement(nestedStatement));
  }
  if (isNodeOfType(statement, "ReturnStatement")) {
    return !statement.argument || isPureDerivedExpression(statement.argument);
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return (
      isPureDerivedExpression(statement.test) &&
      isPureDerivedStatement(statement.consequent) &&
      (!statement.alternate || isPureDerivedStatement(statement.alternate))
    );
  }
  return false;
};

const isPureDerivedFunction = (functionNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return false;
  }
  if (functionNode.async || functionNode.generator) return false;
  return isNodeOfType(functionNode.body, "BlockStatement")
    ? isPureDerivedStatement(functionNode.body)
    : isPureDerivedExpression(functionNode.body);
};

const resolvePureCalledFunctionSourceKeys = (
  reference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): Set<string> | null => {
  if (symbol.references.some((symbolReference) => symbolReference.flag !== "read")) return null;
  const referenceRoot = findTransparentExpressionRoot(reference.identifier);
  const callExpression = referenceRoot.parent;
  if (!isNodeOfType(callExpression, "CallExpression") || callExpression.callee !== referenceRoot) {
    return null;
  }
  const functionNode = getFunctionValueNode(symbol);
  if (!functionNode || !isPureDerivedFunction(functionNode)) return null;
  const sourceKeys = new Set<string>();
  for (const capturedReference of closureCaptures(functionNode, scopes)) {
    const capturedSymbol = capturedReference.resolvedSymbol;
    if (!capturedSymbol || capturedSymbol.id === symbol.id) continue;
    if (isOutsideAllFunctions(capturedSymbol) || symbolHasStableValue(capturedSymbol, scopes)) {
      continue;
    }
    const capturedKey = computeDepKey(capturedReference);
    if (!capturedKey) return null;
    if (capturedKey === capturedSymbol.name) {
      const nestedSourceKeys = resolveReactiveIdentitySourceKeys(capturedSymbol, scopes);
      if (nestedSourceKeys) {
        for (const nestedSourceKey of nestedSourceKeys) sourceKeys.add(nestedSourceKey);
        continue;
      }
    }
    sourceKeys.add(capturedKey);
  }
  return sourceKeys.size > 0 ? sourceKeys : null;
};

const mergeDerivedExpressionSourceKeys = (
  expressions: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): Set<string> | null => {
  const sourceKeys = new Set<string>();
  for (const expression of expressions) {
    const expressionSourceKeys = resolveDerivedExpressionSourceKeys(
      expression,
      scopes,
      visitedSymbolIds,
    );
    if (!expressionSourceKeys) return null;
    for (const expressionSourceKey of expressionSourceKeys) sourceKeys.add(expressionSourceKey);
  }
  return sourceKeys;
};

const resolveDerivedExpressionSourceKeys = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): Set<string> | null => {
  const candidate = unwrapExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return new Set();
  if (isNodeOfType(candidate, "Identifier")) {
    if (scopes.isGlobalReference(candidate)) return new Set();
    const sourceSymbol = scopes.symbolFor(candidate);
    if (!sourceSymbol) return null;
    if (isOutsideAllFunctions(sourceSymbol) || symbolHasStableValue(sourceSymbol, scopes)) {
      return new Set();
    }
    if (
      sourceSymbol.kind === "const" &&
      sourceSymbol.initializer &&
      isNodeOfType(sourceSymbol.declarationNode, "VariableDeclarator") &&
      sourceSymbol.declarationNode.id === sourceSymbol.bindingIdentifier &&
      sourceSymbol.references.every((sourceReference) => sourceReference.flag === "read") &&
      !visitedSymbolIds.has(sourceSymbol.id)
    ) {
      visitedSymbolIds.add(sourceSymbol.id);
      const sourceKeys = resolveDerivedExpressionSourceKeys(
        sourceSymbol.initializer,
        scopes,
        visitedSymbolIds,
      );
      visitedSymbolIds.delete(sourceSymbol.id);
      if (sourceKeys) return sourceKeys;
    }
    return new Set([sourceSymbol.name]);
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    if (hasComputedMemberExpression(candidate)) return null;
    const sourceKey = stringifyMemberChain(candidate);
    const rootIdentifier = getMemberRootIdentifier(candidate);
    const rootSymbol = rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
    if (!sourceKey || !rootSymbol) return null;
    if (isOutsideAllFunctions(rootSymbol) || symbolHasStableValue(rootSymbol, scopes)) {
      return new Set();
    }
    return new Set([sourceKey]);
  }
  if (isNodeOfType(candidate, "BinaryExpression") || isNodeOfType(candidate, "LogicalExpression")) {
    return mergeDerivedExpressionSourceKeys(
      [candidate.left, candidate.right],
      scopes,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator !== "delete") {
    return resolveDerivedExpressionSourceKeys(candidate.argument, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return mergeDerivedExpressionSourceKeys(
      [candidate.test, candidate.consequent, candidate.alternate],
      scopes,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return mergeDerivedExpressionSourceKeys(candidate.expressions, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "NewExpression")) {
    const callee = unwrapExpression(candidate.callee);
    if (
      !isNodeOfType(callee, "Identifier") ||
      callee.name !== "Error" ||
      !scopes.isGlobalReference(callee)
    ) {
      return null;
    }
    const argumentsToAnalyze: EsTreeNode[] = [];
    for (const argument of candidate.arguments) {
      if (!isAstNode(argument) || isNodeOfType(argument, "SpreadElement")) return null;
      argumentsToAnalyze.push(argument);
    }
    return mergeDerivedExpressionSourceKeys(argumentsToAnalyze, scopes, visitedSymbolIds);
  }
  return null;
};

const resolveWriteControlSourceKeys = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  boundaryFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<string> | null => {
  const sourceKeys = new Set<string>();
  let currentNode: EsTreeNode = assignment;
  while (currentNode.parent && currentNode.parent !== boundaryFunction) {
    const parentNode: EsTreeNode = currentNode.parent;
    if (isNodeOfType(parentNode, "IfStatement")) {
      if (parentNode.test === currentNode) return null;
      const testSourceKeys = resolveDerivedExpressionSourceKeys(parentNode.test, scopes, new Set());
      if (!testSourceKeys) return null;
      for (const testSourceKey of testSourceKeys) sourceKeys.add(testSourceKey);
    } else if (
      !isNodeOfType(parentNode, "ExpressionStatement") &&
      !isNodeOfType(parentNode, "BlockStatement")
    ) {
      return null;
    }
    currentNode = parentNode;
  }
  return currentNode.parent === boundaryFunction ? sourceKeys : null;
};

const isReadOnlyInitialStateUse = (referenceNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const referenceRoot = findTransparentExpressionRoot(referenceNode);
  const callExpression = referenceRoot.parent;
  return (
    isNodeOfType(callExpression, "CallExpression") &&
    callExpression.arguments.some((argument) => argument === referenceRoot) &&
    isReactApiCall(callExpression, "useState", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  );
};

const resolveRenderDerivedMutableSourceKeys = (
  capturedReference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): Set<string> | null => {
  if (
    symbol.kind !== "let" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  const boundaryFunction = findEnclosingFunction(symbol.bindingIdentifier);
  if (!boundaryFunction) return null;
  const capturingFunction = findEnclosingFunction(capturedReference.identifier);
  if (!capturingFunction || capturingFunction === boundaryFunction) return null;
  const sourceKeys = new Set<string>();
  if (symbol.initializer) {
    const initializerSourceKeys = resolveDerivedExpressionSourceKeys(
      symbol.initializer,
      scopes,
      new Set([symbol.id]),
    );
    if (!initializerSourceKeys) return null;
    for (const initializerSourceKey of initializerSourceKeys) sourceKeys.add(initializerSourceKey);
  }
  let writeCount = 0;
  for (const symbolReference of symbol.references) {
    if (symbolReference.flag === "read") {
      if (
        findEnclosingFunction(symbolReference.identifier) !== capturingFunction &&
        !isReadOnlyInitialStateUse(symbolReference.identifier, scopes)
      ) {
        return null;
      }
      continue;
    }
    if (symbolReference.flag !== "write") return null;
    const referenceRoot = findTransparentExpressionRoot(symbolReference.identifier);
    const assignment = referenceRoot.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== referenceRoot ||
      findEnclosingFunction(referenceRoot) !== boundaryFunction
    ) {
      return null;
    }
    const assignmentSourceKeys = resolveDerivedExpressionSourceKeys(
      assignment.right,
      scopes,
      new Set([symbol.id]),
    );
    const controlSourceKeys = resolveWriteControlSourceKeys(assignment, boundaryFunction, scopes);
    if (!assignmentSourceKeys || !controlSourceKeys) return null;
    for (const assignmentSourceKey of assignmentSourceKeys) sourceKeys.add(assignmentSourceKey);
    for (const controlSourceKey of controlSourceKeys) sourceKeys.add(controlSourceKey);
    writeCount += 1;
  }
  return writeCount > 0 && sourceKeys.size > 0 ? sourceKeys : null;
};

// Extra (unused) deps in effect hooks are allowed as intentional
// re-run triggers (upstream blesses `useEffect(() => scrollTo(0, 0),
// [activeTab])`). A `useCallback(...)` binding is the one shape that
// can't be a meaningful trigger: its identity is a pure artifact of
// its own deps array, so an author wanting a trigger would list those
// deps directly — an unused memoized callback in effect deps is a
// refactoring leftover.
const isUseCallbackResultDep = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const rootSymbol = getRootSymbol(node, scopes);
  const initializer = rootSymbol?.initializer ? unwrapExpression(rootSymbol.initializer) : null;
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    getHookName(initializer.callee, scopes) === "useCallback",
  );
};

const isExtraReactiveDepAllowed = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const rootIdentifier = getMemberRootIdentifier(node);
  if (!rootIdentifier) return false;
  const symbol = scopes.symbolFor(rootIdentifier);
  if (!symbol || isOutsideAllFunctions(symbol)) return false;
  return !isUseCallbackResultDep(node, scopes);
};

const getRootSymbol = (node: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  const rootIdentifier = getMemberRootIdentifier(node);
  return rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
};

// A declared dep written as a zero-arg accessor call (`getConfig()`) is
// keyed by its callee, so symbol lookups for that dep must also resolve
// through the callee — `getMemberRootIdentifier` returns null on a
// CallExpression node.
const getDeclaredDepSymbolSource = (node: EsTreeNode): EsTreeNode => {
  const stripped = unwrapExpression(node);
  if (isNodeOfType(stripped, "CallExpression") && (stripped.arguments?.length ?? 0) === 0) {
    return stripped.callee;
  }
  return node;
};

const isRegExpLiteral = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "Literal")) return false;
  return Boolean((node as { regex?: unknown }).regex);
};

const isUnstableInitializer = (node: EsTreeNode | null, isNestedInitializer = false): boolean => {
  if (!node) return false;
  const stripped = unwrapExpression(node);
  if (isRegExpLiteral(stripped)) return true;
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isUnstableInitializer(stripped.consequent, true) ||
      isUnstableInitializer(stripped.alternate, true)
    );
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isUnstableInitializer(stripped.left, true) || isUnstableInitializer(stripped.right, true)
    );
  }
  return (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    (isNestedInitializer &&
      (isNodeOfType(stripped, "ArrowFunctionExpression") ||
        isNodeOfType(stripped, "FunctionExpression"))) ||
    isNodeOfType(stripped, "ClassExpression") ||
    isNodeOfType(stripped, "ClassDeclaration") ||
    isNodeOfType(stripped, "JSXElement") ||
    isNodeOfType(stripped, "JSXFragment") ||
    isNodeOfType(stripped, "AssignmentExpression") ||
    isNodeOfType(stripped, "NewExpression")
  );
};

const isPotentiallyFreshComparedValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = unwrapExpression(node);
  if (isUnstableInitializer(candidate)) return true;
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      isPotentiallyFreshComparedValue(candidate.consequent, scopes, visitedSymbolIds) ||
      isPotentiallyFreshComparedValue(candidate.alternate, scopes, visitedSymbolIds)
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      isPotentiallyFreshComparedValue(candidate.left, scopes, visitedSymbolIds) ||
      isPotentiallyFreshComparedValue(candidate.right, scopes, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (symbol.kind === "let" || symbol.kind === "var") return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return isPotentiallyFreshComparedValue(symbol.initializer, scopes, visitedSymbolIds);
};

const isExtraDepAllowedForHook = (
  hookName: string,
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isExtraReactiveDepAllowed(node, scopes)) return false;
  if (EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName)) return true;
  if (hookName !== "useMemo") return false;
  const rootSymbol = getRootSymbol(node, scopes);
  return Boolean(
    rootSymbol &&
    !symbolHasStableValue(rootSymbol, scopes) &&
    !isUnstableInitializer(rootSymbol.initializer),
  );
};

const hasDirectIdentifierDeclarator = (symbol: SymbolDescriptor): boolean =>
  (isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(symbol.declarationNode.id, "Identifier")) ||
  isNodeOfType(symbol.declarationNode, "ClassDeclaration");

const isFunctionValueSymbol = (symbol: SymbolDescriptor): boolean =>
  getFunctionValueNode(symbol) !== null;

interface StateSetterDescriptor {
  setterSymbol: SymbolDescriptor;
  stateSymbol: SymbolDescriptor | null;
}

const FRESH_STATE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "Date",
  "Error",
  "Map",
  "Object",
  "RegExp",
  "Set",
  "WeakMap",
  "WeakSet",
]);

const getBindingIdentifier = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  const candidate = isNodeOfType(node, "AssignmentPattern") ? node.left : node;
  return isNodeOfType(candidate, "Identifier") ? candidate : null;
};

const resolveStateSetterSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const visitedSymbolIds = new Set<number>();
  let symbol = scopes.symbolFor(identifier);
  while (
    symbol?.kind === "const" &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.initializer
  ) {
    if (visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    const initializer = unwrapExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) return symbol;
    symbol = scopes.symbolFor(initializer);
  }
  return symbol;
};

const getStateSetterDescriptor = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): StateSetterDescriptor | null => {
  const setterSymbol = resolveStateSetterSymbol(identifier, scopes);
  if (!setterSymbol || !isNodeOfType(setterSymbol.declarationNode, "VariableDeclarator")) {
    return null;
  }
  const declarator = setterSymbol.declarationNode;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const setterElement = declarator.id.elements?.[1];
  const setterBinding = isAstNode(setterElement) ? getBindingIdentifier(setterElement) : null;
  if (!setterBinding || setterBinding !== setterSymbol.bindingIdentifier) return null;
  const initializer = declarator.init ? unwrapExpression(declarator.init) : null;
  if (
    !initializer ||
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useState", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const stateElement = declarator.id.elements?.[0];
  const stateBinding = isAstNode(stateElement) ? getBindingIdentifier(stateElement) : null;
  return {
    setterSymbol,
    stateSymbol: stateBinding ? scopes.symbolFor(stateBinding) : null,
  };
};

const expressionReadsSymbol = (
  node: EsTreeNode,
  symbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  if (!symbol) return false;
  const candidate = unwrapExpression(node);
  if (isNodeOfType(candidate, "Identifier")) {
    const reference = scopes.referenceFor(candidate);
    if (reference?.flag !== "write" && reference?.resolvedSymbol?.id === symbol.id) return true;
    const candidateSymbol = reference?.resolvedSymbol;
    if (
      candidateSymbol?.kind === "const" &&
      candidateSymbol.initializer &&
      !isOutsideAllFunctions(candidateSymbol) &&
      !visitedSymbolIds.has(candidateSymbol.id)
    ) {
      const nextVisitedSymbolIds = new Set(visitedSymbolIds);
      nextVisitedSymbolIds.add(candidateSymbol.id);
      return expressionReadsSymbol(
        candidateSymbol.initializer,
        symbol,
        scopes,
        nextVisitedSymbolIds,
      );
    }
    return false;
  }
  const record = candidate as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "parent") continue;
    const child = record[key];
    if (Array.isArray(child)) {
      if (child.some((item) => isAstNode(item) && expressionReadsSymbol(item, symbol, scopes))) {
        return true;
      }
    } else if (isAstNode(child) && expressionReadsSymbol(child, symbol, scopes)) {
      return true;
    }
  }
  return false;
};

const isGuaranteedFreshStateValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const candidate = unwrapExpression(node);
  if (
    isNodeOfType(candidate, "ObjectExpression") ||
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "JSXElement") ||
    isNodeOfType(candidate, "JSXFragment") ||
    isRegExpLiteral(candidate)
  ) {
    return true;
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const finalExpression = candidate.expressions.at(-1);
    return Boolean(finalExpression && isGuaranteedFreshStateValue(finalExpression, scopes));
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      isGuaranteedFreshStateValue(candidate.consequent, scopes, visitedSymbolIds) &&
      isGuaranteedFreshStateValue(candidate.alternate, scopes, visitedSymbolIds)
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      isGuaranteedFreshStateValue(candidate.left, scopes, visitedSymbolIds) &&
      isGuaranteedFreshStateValue(candidate.right, scopes, visitedSymbolIds)
    );
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = unwrapExpression(candidate.callee);
    return (
      isNodeOfType(callee, "Identifier") &&
      scopes.isGlobalReference(callee) &&
      (callee.name === "Array" || callee.name === "Object") &&
      (callee.name === "Array" || candidate.arguments.length === 0)
    );
  }
  if (isNodeOfType(candidate, "NewExpression")) {
    const callee = unwrapExpression(candidate.callee);
    return (
      isNodeOfType(callee, "Identifier") &&
      scopes.isGlobalReference(callee) &&
      FRESH_STATE_CONSTRUCTOR_NAMES.has(callee.name) &&
      (callee.name !== "Object" || candidate.arguments.length === 0)
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    isOutsideAllFunctions(symbol) ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return false;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return isGuaranteedFreshStateValue(symbol.initializer, scopes, nextVisitedSymbolIds);
};

const isNonZeroLiteral = (node: EsTreeNode): boolean => {
  const candidate = unwrapExpression(node);
  return (
    isNodeOfType(candidate, "Literal") &&
    ((typeof candidate.value === "number" && candidate.value !== 0) ||
      (typeof candidate.value === "bigint" && candidate.value !== 0n) ||
      (typeof candidate.value === "string" && candidate.value.length > 0))
  );
};

const isProvablyChangingExpression = (
  node: EsTreeNode,
  previousValueSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = unwrapExpression(node);
  if (isGuaranteedFreshStateValue(candidate, scopes)) return true;
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    const isConsequentChanging = isProvablyChangingExpression(
      candidate.consequent,
      previousValueSymbol,
      scopes,
    );
    const isAlternateChanging = isProvablyChangingExpression(
      candidate.alternate,
      previousValueSymbol,
      scopes,
    );
    return expressionReadsSymbol(candidate.test, previousValueSymbol, scopes)
      ? isConsequentChanging && isAlternateChanging
      : isConsequentChanging || isAlternateChanging;
  }
  if (!expressionReadsSymbol(candidate, previousValueSymbol, scopes)) return false;
  if (isNodeOfType(candidate, "UnaryExpression")) return candidate.operator === "!";
  if (isNodeOfType(candidate, "UpdateExpression")) return true;
  if (!isNodeOfType(candidate, "BinaryExpression")) return false;
  return (
    (candidate.operator === "+" || candidate.operator === "-") &&
    expressionReadsSymbol(candidate.left, previousValueSymbol, scopes) &&
    isNonZeroLiteral(candidate.right)
  );
};

const isFreshEqualityGuardUpdater = (
  node: EsTreeNode,
  previousValueSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = unwrapExpression(node);
  if (!isNodeOfType(candidate, "ConditionalExpression")) return false;
  const test = unwrapExpression(candidate.test);
  if (
    !isNodeOfType(test, "BinaryExpression") ||
    !["===", "!==", "==", "!="].includes(test.operator)
  ) {
    return false;
  }
  const isPreviousValue = (expression: EsTreeNode): boolean => {
    const expressionCandidate = unwrapExpression(expression);
    return (
      isNodeOfType(expressionCandidate, "Identifier") &&
      scopes.symbolFor(expressionCandidate)?.id === previousValueSymbol?.id
    );
  };
  let comparedValue: EsTreeNode | null = null;
  if (isPreviousValue(test.left)) comparedValue = test.right;
  if (isPreviousValue(test.right)) comparedValue = test.left;
  if (!comparedValue || !isPotentiallyFreshComparedValue(comparedValue, scopes)) return false;
  const isComparedValue = (expression: EsTreeNode): boolean => {
    const expressionCandidate = unwrapExpression(expression);
    const comparedCandidate = unwrapExpression(comparedValue);
    if (isNodeOfType(expressionCandidate, "Identifier")) {
      return (
        isNodeOfType(comparedCandidate, "Identifier") &&
        scopes.symbolFor(expressionCandidate)?.id === scopes.symbolFor(comparedCandidate)?.id
      );
    }
    return (
      isNodeOfType(expressionCandidate, "Literal") &&
      isNodeOfType(comparedCandidate, "Literal") &&
      expressionCandidate.value === comparedCandidate.value
    );
  };
  const equalityTest = test.operator === "===" || test.operator === "==";
  return equalityTest
    ? isPreviousValue(candidate.consequent) && isComparedValue(candidate.alternate)
    : isComparedValue(candidate.consequent) && isPreviousValue(candidate.alternate);
};

const isProvablyChangingFunctionalUpdater = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const updater = unwrapExpression(node);
  if (
    !isNodeOfType(updater, "ArrowFunctionExpression") &&
    !isNodeOfType(updater, "FunctionExpression")
  ) {
    return false;
  }
  const previousValueParameter = updater.params?.[0];
  if (!previousValueParameter || !isNodeOfType(previousValueParameter, "Identifier")) return false;
  const previousValueSymbol = scopes.symbolFor(previousValueParameter);
  if (!isNodeOfType(updater.body, "BlockStatement")) {
    return (
      isFreshEqualityGuardUpdater(updater.body, previousValueSymbol, scopes) ||
      isProvablyChangingExpression(updater.body, previousValueSymbol, scopes)
    );
  }
  if (updater.body.body.length !== 1) return false;
  const soleStatement = updater.body.body[0];
  if (!isNodeOfType(soleStatement, "ReturnStatement") || !isAstNode(soleStatement.argument)) {
    return false;
  }
  return (
    isFreshEqualityGuardUpdater(soleStatement.argument, previousValueSymbol, scopes) ||
    isProvablyChangingExpression(soleStatement.argument, previousValueSymbol, scopes)
  );
};

const isProvablyRenderChangingSetterCall = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const setterCall = identifier.parent;
  if (
    !setterCall ||
    !isNodeOfType(setterCall, "CallExpression") ||
    setterCall.callee !== identifier
  ) {
    return false;
  }
  const descriptor = getStateSetterDescriptor(identifier, scopes);
  const writtenValue = setterCall.arguments?.[0];
  if (!descriptor || !writtenValue || !isAstNode(writtenValue)) return false;
  return isProvablyChangingFunctionalUpdater(writtenValue, scopes)
    ? true
    : isProvablyChangingExpression(writtenValue, descriptor.stateSymbol, scopes);
};

const findRenderChangingStateSetterName = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
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
      const descriptor = getStateSetterDescriptor(current, scopes);
      if (descriptor && isProvablyRenderChangingSetterCall(current, scopes)) {
        setterName = descriptor.setterSymbol.name;
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

interface RefCurrentInCleanup {
  refCurrentName: string;
  refSymbol: SymbolDescriptor | null;
}

const findRefCurrentInCleanup = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): RefCurrentInCleanup | null => {
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

  let found: RefCurrentInCleanup | null = null;
  const visitCleanup = (node: EsTreeNode): void => {
    if (found) return;
    if (isNodeOfType(node, "MemberExpression")) {
      const candidateName = getRefCurrentNameFromMemberExpression(node);
      if (candidateName) {
        const rootIdentifier = getMemberRootIdentifier(node);
        const symbol = rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
        const callbackScope = scopes.ownScopeFor(callback) ?? scopes.scopeFor(callback);
        if (!symbol || !isDescendantScope(symbol.scope, callbackScope)) {
          found = { refCurrentName: candidateName, refSymbol: symbol };
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
  return found;
};

const hasRefCurrentAssignmentInComponent = (refSymbol: SymbolDescriptor | null): boolean => {
  if (!refSymbol) return false;
  for (const reference of refSymbol.references) {
    const memberParent = reference.identifier.parent;
    if (!memberParent || !isNodeOfType(memberParent, "MemberExpression")) continue;
    if (memberParent.object !== reference.identifier) continue;
    if (getRefCurrentNameFromMemberExpression(memberParent) === null) continue;
    const assignmentParent = memberParent.parent;
    if (
      assignmentParent &&
      isNodeOfType(assignmentParent, "AssignmentExpression") &&
      assignmentParent.left === memberParent
    ) {
      return true;
    }
    // `ref.current++` / `ref.current--` marks a mutable counter ref the
    // component owns, not a React-managed DOM node.
    if (
      assignmentParent &&
      isNodeOfType(assignmentParent, "UpdateExpression") &&
      assignmentParent.argument === memberParent
    ) {
      return true;
    }
  }
  return false;
};

// A ref seeded with a real value (`useRef(new Set())`, `useRef(0)`,
// `useRef({ timer: null })`) is a mutable data cell, not a handle to a
// React-rendered DOM node — the "cleanup may read the wrong node"
// warning doesn't apply. `useRef()` / `useRef(null)` stay eligible:
// that's the DOM-ref idiom the warning exists for.
const isSeededDataRefSymbol = (
  refSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!refSymbol) return false;
  const initializer = refSymbol.initializer ? unwrapExpression(refSymbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  if (getHookName(initializer.callee, scopes) !== "useRef") return false;
  const firstArgument = initializer.arguments[0];
  if (!firstArgument || !isAstNode(firstArgument)) return false;
  const strippedArgument = unwrapExpression(firstArgument);
  if (isNodeOfType(strippedArgument, "Literal") && strippedArgument.value === null) return false;
  if (isNodeOfType(strippedArgument, "Identifier") && strippedArgument.name === "undefined") {
    return false;
  }
  return true;
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

const hasMemberCallForRoot = (
  node: EsTreeNode,
  rootName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const rootSymbol =
    closureCaptures(node, scopes).find((reference) => reference.resolvedSymbol?.name === rootName)
      ?.resolvedSymbol ?? null;
  if (!rootSymbol) return false;
  let didFindMemberCall = false;
  const visit = (current: EsTreeNode): void => {
    if (didFindMemberCall) return;
    if (isNodeOfType(current, "CallExpression")) {
      const callee = unwrapExpression(current.callee);
      if (isNodeOfType(callee, "MemberExpression")) {
        let chainObject = unwrapExpression(callee.object);
        let doesChainPassThroughCurrent = false;
        while (chainObject && isNodeOfType(chainObject, "MemberExpression")) {
          if (
            isNodeOfType(chainObject.property, "Identifier") &&
            chainObject.property.name === "current"
          ) {
            doesChainPassThroughCurrent = true;
            break;
          }
          chainObject = unwrapExpression(chainObject.object);
        }
        if (
          !doesChainPassThroughCurrent &&
          chainObject &&
          isNodeOfType(chainObject, "Identifier") &&
          chainObject.name === rootName &&
          scopes.symbolFor(chainObject) === rootSymbol
        ) {
          didFindMemberCall = true;
          return;
        }
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
  scopes: ScopeAnalysis,
): void => {
  const propsCaptureKeys = [...captureKeys].filter((captureKey) => captureKey.startsWith("props."));
  const propsCaptureCount = propsCaptureKeys.length;
  if (propsCaptureCount < 2 || declaredKeys.has("props")) return;
  const areAllPropsCapturesCovered = propsCaptureKeys.every((captureKey) =>
    [...declaredKeys].some((declaredKey) => isMatchingDepOrPrefix(declaredKey, captureKey)),
  );
  if (areAllPropsCapturesCovered) return;
  if (hasMemberCallForRoot(callback, "props", scopes)) captureKeys.add("props");
};

export const exhaustiveDeps = defineRule({
  id: "exhaustive-deps",
  title: "Missing effect dependencies",
  severity: "warn",
  tags: ["test-noise"],
  recommendation: `Don't blindly add missing dependencies. Read the hook callback first.

Bad:
useEffect(() => {
  setCount(count + 1);
}, [count]);

Better:
useEffect(() => {
  setCount((currentCount) => currentCount + 1);
}, []);

If the missing value is recreated every render, move it inside the hook or stabilize it before adding it to deps.`,
  category: "Correctness",
  create: (hostContext) => {
    const nodeStartOffset = (node: EsTreeNode): number | null => {
      const nodeWithOffsets = node as { start?: number; range?: [number, number] };
      if (typeof nodeWithOffsets.start === "number") return nodeWithOffsets.start;
      if (Array.isArray(nodeWithOffsets.range)) return nodeWithOffsets.range[0];
      return null;
    };
    const context: typeof hostContext = {
      get filename() {
        return hostContext.filename;
      },
      get settings() {
        return hostContext.settings;
      },
      get scopes() {
        return hostContext.scopes;
      },
      get cfg() {
        return hostContext.cfg;
      },
      report: (descriptor) => {
        if (isExhaustiveDepsSuppressedAt(hostContext.filename, nodeStartOffset(descriptor.node))) {
          return;
        }
        hostContext.report(descriptor);
      },
    };
    const settings = resolveExhaustiveDepsSettings(context.settings);
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
        for (const finding of findForwardedFreshHookDependencies(
          node,
          context,
          EFFECT_HOOK_NAMES,
        )) {
          context.report({
            node: finding.reportNode,
            message: buildForwardedUnstableDepMessage(finding.bindingName),
          });
        }

        const hookName = getHookName(node.callee, context.scopes);
        if (!hookName || !isHookOfInterest(hookName, node.callee)) return;
        if (
          HOOKS_REQUIRING_DEPS_MATCH.has(hookName) &&
          !isReactApiCall(node, HOOKS_REQUIRING_DEPS_MATCH, context.scopes, {
            allowGlobalReactNamespace: true,
            allowUnboundBareCalls: true,
            resolveNamedAliases: true,
          })
        ) {
          return;
        }

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
          } else if (callbackSymbol && isOutsideAllFunctions(callbackSymbol) && depsArgumentRaw) {
            // A module-scope callback (usually an import) cannot close
            // over render-scoped values, so nothing in it can be stale.
            return;
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
          const refCurrentInCleanup = findRefCurrentInCleanup(callbackToAnalyze, context.scopes);
          const shouldCheckRefCleanup =
            EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName) ||
            Boolean(additionalHooksRegex && additionalHooksRegex.test(hookName));
          if (
            refCurrentInCleanup &&
            shouldCheckRefCleanup &&
            !hasRefCurrentAssignment(callbackToAnalyze, refCurrentInCleanup.refCurrentName) &&
            !hasRefCurrentAssignmentInComponent(refCurrentInCleanup.refSymbol) &&
            !isSeededDataRefSymbol(refCurrentInCleanup.refSymbol, context.scopes)
          ) {
            context.report({
              node: callbackToAnalyze,
              message: buildRefCleanupMessage(refCurrentInCleanup.refCurrentName),
            });
          }
        }

        if (!depsArgumentRaw) {
          if (callbackToAnalyze && EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS.has(hookName)) {
            const setterName = findRenderChangingStateSetterName(callbackToAnalyze, context.scopes);
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

        // An explicit `undefined` deps argument is the same as omitting
        // it (run on every commit), so upstream treats it as "no deps"
        // for useEffect-style hooks and only flags it for hooks that
        // require deps. A `null` deps argument stays a non-array report
        // below, matching upstream.
        const depsArgument = unwrapExpression(depsArgumentRaw as EsTreeNode);
        if (isNodeOfType(depsArgument, "Identifier") && depsArgument.name === "undefined") {
          if (isAutoDependenciesHook(hookName)) return;
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName)) {
            context.report({
              node: depsArgument,
              message: buildMissingDepArrayMessage(hookName),
            });
          }
          return;
        }
        if (isNodeOfType(depsArgument, "Literal") && depsArgument.value === null) {
          if (isAutoDependenciesHook(hookName)) return;
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName)) {
            context.report({
              node: depsArgument,
              message: buildMissingDepArrayMessage(hookName),
            });
            return;
          }
        }

        if (!isNodeOfType(depsArgument, "ArrayExpression")) {
          // A deps list forwarded from a function parameter is the
          // documented API of reusable custom hooks (`useCustomEffect(cb,
          // deps)` mirrors useEffect's own contract) — the caller owns
          // the array, so there is nothing to verify here.
          const depsSymbol = isNodeOfType(depsArgument, "Identifier")
            ? context.scopes.symbolFor(depsArgument)
            : null;
          if (depsSymbol?.kind === "parameter") return;
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
        const declaredExactBindingKeys = new Set<string>();
        const declaredKeyToReportNode = new Map<string, EsTreeNode>();
        const seenDeclaredKeys = new Set<string>();
        let didReportRefCurrentDep = false;
        let didReportDuplicateDep = false;
        for (const element of depsArgument.elements) {
          if (!element) continue;
          const elementNode = element as EsTreeNode;
          if (isNodeOfType(elementNode, "SpreadElement")) {
            // Spreading a caller-supplied deps parameter (`[...resetDeps]`,
            // `[...options.deps]`) is the deliberate forwarding API of a
            // reusable hook, not a hidden-deps mistake.
            const spreadRootSymbol = getRootSymbol(elementNode.argument, context.scopes);
            if (spreadRootSymbol?.kind !== "parameter") {
              context.report({ node: elementNode, message: buildSpreadDepMessage(hookName) });
            }
            continue;
          }
          const stripped = unwrapExpression(elementNode);

          if (isLiteralOrEmptyTemplate(stripped)) continue;

          if (isNodeOfType(stripped, "Identifier")) {
            const depSymbol = context.scopes.symbolFor(stripped);
            if (depSymbol && symbolHasReactUseEffectEventOrigin(depSymbol, context.scopes)) {
              context.report({
                node: elementNode,
                message: buildEffectEventDepMessage(),
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
            if (refSymbol && symbolHasStableHookOrigin(refSymbol, context.scopes)) {
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
          if (isNodeOfType(stripped, "Identifier")) declaredExactBindingKeys.add(key);
          declaredKeyToReportNode.set(key, elementNode);
        }
        const {
          keys: captureKeys,
          stableCapturedNames,
          moduleScopeCapturedNames,
          outerFunctionCapturedNames,
        } = collectCaptureDepKeys(
          callbackToAnalyze ?? callbackArgument,
          context.scopes,
          declaredExactBindingKeys,
          SOLE_WRITER_GUARD_HOOKS.has(hookName),
        );
        for (const forcedCaptureKey of forcedCaptureKeys) captureKeys.add(forcedCaptureKey);
        addAggregatePropsDependency(
          captureKeys,
          declaredKeys,
          callbackToAnalyze ?? callbackArgument,
          context.scopes,
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
          const rootSymbol = getRootSymbol(getDeclaredDepSymbolSource(reportNode), context.scopes);
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
          if (stableCapturedNames.has(rootName) || stableCapturedNames.has(declaredKey)) continue;
          if (outerFunctionCapturedNames.has(rootName)) continue;
          const reportNode = declaredKeyToReportNode.get(declaredKey) ?? depsArgument;
          if (isExtraDepAllowedForHook(hookName, reportNode, context.scopes)) {
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
          // An UNUSED zero-arg call dep (`Date.now()`) re-runs the hook
          // because the call RESULT changes, not the callee binding —
          // the callee-keyed unnecessary-dep message would be factually
          // wrong, so report it as a complex expression instead.
          if (isNodeOfType(unwrapExpression(reportNode), "CallExpression")) {
            context.report({ node: reportNode, message: buildComplexDepMessage(hookName) });
            continue;
          }
          unnecessaryDeclaredKeys.push(declaredKey);
          unnecessaryReportNode = reportNode;
        }
        if (unnecessaryDeclaredKeys.length > 0) {
          // When every redundant dep IS read by the callback but lives at
          // module scope, the "never uses it" wording would be factually
          // wrong — say why the dep is redundant instead.
          const areAllModuleScopeCaptured = unnecessaryDeclaredKeys.every((declaredKey) =>
            moduleScopeCapturedNames.has(declaredKey.split(".")[0]!),
          );
          context.report({
            node: unnecessaryReportNode,
            message: areAllModuleScopeCaptured
              ? buildModuleScopeDepMessage(hookName, unnecessaryDeclaredKeys.join(", "))
              : buildUnnecessaryDepMessage(hookName, unnecessaryDeclaredKeys.join(", ")),
          });
        }
      },
    };
  },
});
