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
import { REACT_HOC_NAMES } from "../../constants/react.js";
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
  buildLiteralDepMessage,
  buildMissingCallbackMessage,
  buildMissingDepArrayMessage,
  buildMissingDepMessage,
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
import {
  getFunctionValueNode,
  isRecursiveInitializerCapture,
  symbolHasStableHookOrigin,
  symbolHasStableValue,
  symbolHasUseEffectEventOrigin,
} from "./exhaustive-deps-symbol-stability.js";

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
  // Parameter default values and computed destructuring keys are now
  // recorded as references by the scope analyzer, so `closureCaptures`
  // already collects them through the SAME filtered path as the body
  // above (module-scope / stable values excluded). A separate manual
  // param walk used to live here and added every default-value name
  // unconditionally — which mis-reported module constants like
  // `(opts = SOME_CONST) => …` as missing deps.
  return { keys, stableCapturedNames };
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
  create: (context) => {
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
