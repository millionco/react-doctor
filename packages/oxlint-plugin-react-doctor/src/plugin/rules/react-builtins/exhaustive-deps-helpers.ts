import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const buildMissingDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` is missing dependency \`${depName}\` — list it in the dependency array, or call the hook unconditionally.`;
export const buildUnnecessaryDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` has an unnecessary dependency \`${depName}\` — it isn't referenced inside the callback.`;
export const buildDuplicateDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` has duplicate dependency \`${depName}\`.`;
export const buildLiteralDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` was passed a literal as a dependency. Literals never change so they cannot trigger an update — remove them from the dependency array.`;
export const buildRefCurrentDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` shouldn't include \`${depName}\` in the dependency array — mutable values like \`.current\` aren't valid deps; depend on \`${depName.replace(/\.current$/, "")}\` itself instead.`;
export const buildNonArrayDepsMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a second argument which is not an array literal. This means oxlint cannot statically verify whether the dependencies are exhaustive — replace the variable with an inline array.`;
export const buildMissingDepArrayMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` does nothing when called with only one argument — pass a dependency array as the second argument.`;
export const buildMissingCallbackMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` requires an effect callback — pass a function as the first argument.`;
export const buildEffectEventDepMessage = (depName: string): string =>
  `Functions returned from \`useEffectEvent\` must not be included in the dependency array. Remove \`${depName}\` from the list.`;
export const buildSpreadDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a spread element in its dependency array. This means oxlint cannot statically verify whether the dependencies are exhaustive.`;
export const buildComplexDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a complex expression in the dependency array. Extract it to a separate variable so it can be statically checked.`;
export const buildAsyncEffectMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` received an async callback. Put the async function inside the effect instead.`;
export const buildUnknownCallbackMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` received a function whose dependencies are unknown. Pass an inline function instead.`;
export const buildUnstableDepMessage = (hookName: string, depName: string): string =>
  `The \`${depName}\` value makes the dependencies of \`${hookName}\` change on every render. Move it inside the hook callback or wrap it in its own memoization hook.`;
export const buildSetStateWithoutDepsMessage = (hookName: string, setterName: string): string =>
  `React Hook \`${hookName}\` contains a call to \`${setterName}\`. Without a dependency array, this can lead to an infinite chain of updates.`;
export const buildRefCleanupMessage = (depName: string): string =>
  `The ref value \`${depName}\` will likely have changed by the time this effect cleanup function runs. Copy it to a variable inside the hook callback and use that variable in cleanup.`;
export const buildAssignmentMessage = (name: string): string =>
  `Assignments to the \`${name}\` variable from inside a React Hook will be lost after each render. Store it in a ref to preserve the value over time.`;

interface ExhaustiveDepsSettings {
  additionalHooks?: string;
  additionalEffectHooks?: string;
  enableDangerousAutofixThisMayCauseInfiniteLoops?: boolean;
  experimental_autoDependenciesHooks?: ReadonlyArray<string>;
  requireExplicitEffectDeps?: boolean;
}

export const resolveSettings = (
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

export const HOOKS_REQUIRING_DEPS_MATCH: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useCallback",
  "useMemo",
  "useImperativeHandle",
  "useInsertionEffect",
]);

export const HOOKS_REQUIRING_DEPS_ARRAY: ReadonlySet<string> = new Set(["useMemo", "useCallback"]);

export const EFFECT_HOOKS_ALLOWING_EXTRA_REACTIVE_DEPS: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

export const buildAdditionalHooksRegex = (additional: string): RegExp | null => {
  if (!additional) return null;
  try {
    return new RegExp(additional);
  } catch {
    return null;
  }
};

export const getHookName = (callee: EsTreeNode): string | null => {
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

export const findEnclosingComponentOrHookFunction = (node: EsTreeNode): EsTreeNode | null => {
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

export const getCallbackArgumentIndex = (hookName: string): number =>
  hookName === "useImperativeHandle" ? 1 : 0;

export const getDepsArgumentIndex = (hookName: string): number =>
  hookName === "useImperativeHandle" ? 2 : 1;
