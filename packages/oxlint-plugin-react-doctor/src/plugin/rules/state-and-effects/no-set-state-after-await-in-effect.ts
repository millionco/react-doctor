import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionBodyHasReturnWithValue } from "../../utils/function-body-has-return-with-value.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookBindingInScope } from "../../utils/is-hook-binding-in-scope.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This setter runs after `await`, so overlapping re-runs of the effect can resolve out of order and write stale state; gate it behind a cancellation/ignore flag or return a cleanup that cancels the work.";

const STATE_DISPATCHER_HOOKS = new Set(["useState", "useReducer"]);
const STABLE_IDENTITY_HOOK = "useRef";
const EXTERNAL_STORE_HOOK_PATTERN = /^use(?:[A-Z][A-Za-z0-9]*)?Store$/;
// Hooks whose result identity is stable for the component's lifetime
// (react-router's navigate, redux dispatch, react-query's client) — a deps
// array of only these is de-facto mount-only, so overlapping re-runs cannot
// occur. Corpus-verified: NextChat's `[navigate]` effect.
const STABLE_RESULT_HOOKS = new Set(["useNavigate", "useDispatch", "useQueryClient", "useRouter"]);
// Typed wrappers over stable dispatchers (Redux Toolkit's documented
// `useAppDispatch`) share the base hook's identity guarantee.
const STABLE_RESULT_HOOK_PATTERN = /^use[A-Z]\w*Dispatch$/;
// Hooks whose destructured METHODS are documented stable (react-hook-form's
// `reset`/`setValue` from useForm).
const STABLE_METHOD_HOOKS = new Set(["useForm"]);

// Cancellation / mounted-guard idioms. When the awaiting scope reads any of
// these we assume the developer already guards the post-await write, so we
// stay quiet — false positives are worse than the occasional missed case.
const CANCELLATION_GUARD_PATTERN =
  /^(?:is|has|did|was)?_?(?:mount|unmount|cancel|abort|ignore|stale|dispos|destroy|alive|signal|active)/i;

const getDependencyArray = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  const dependencyArgument = effectCall.arguments?.[1];
  if (!dependencyArgument || !isNodeOfType(dependencyArgument, "ArrayExpression")) return null;
  return dependencyArgument;
};

const doesBindingPatternBindName = (pattern: unknown, bindingName: string): boolean => {
  if (isNodeOfType(pattern, "Identifier")) return pattern.name === bindingName;
  if (isNodeOfType(pattern, "ObjectPattern")) {
    return (pattern.properties ?? []).some((property) => {
      if (isNodeOfType(property, "Property")) {
        return doesBindingPatternBindName(property.value, bindingName);
      }
      if (isNodeOfType(property, "RestElement")) {
        return doesBindingPatternBindName(property.argument, bindingName);
      }
      return false;
    });
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    return (pattern.elements ?? []).some((element) =>
      doesBindingPatternBindName(element, bindingName),
    );
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return doesBindingPatternBindName(pattern.left, bindingName);
  }
  if (isNodeOfType(pattern, "RestElement")) {
    return doesBindingPatternBindName(pattern.argument, bindingName);
  }
  return false;
};

// External-store hooks (zustand's useStore / useXxxStore) hand back action
// references that are stable for the store's lifetime, so a dep bound from
// one cannot re-trigger the effect (NotificationsView-class false positive).
const isExternalStoreHookBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          const storeHookCallee = declarator.init.callee;
          if (!isNodeOfType(storeHookCallee, "Identifier")) continue;
          if (!EXTERNAL_STORE_HOOK_PATTERN.test(storeHookCallee.name)) continue;
          if (doesBindingPatternBindName(declarator.id, bindingName)) return true;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// Store hooks also select mutable data; only a dep the effect exclusively
// INVOKES is action-shaped. Any other read (argument, member base, shorthand
// spread) means the dep carries data whose identity can change per render.
const isDependencyOnlyInvokedInCallback = (
  effectCallback: EsTreeNode,
  bindingName: string,
): boolean => {
  let hasNonInvocationUse = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (hasNonInvocationUse) return false;
    if (!isNodeOfType(child, "Identifier") || child.name !== bindingName) return;
    const parent = child.parent;
    if (isNodeOfType(parent, "CallExpression") && parent.callee === child) return;
    if (isNodeOfType(parent, "MemberExpression") && parent.property === child && !parent.computed) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === child &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return;
    }
    hasNonInvocationUse = true;
    return false;
  });
  return !hasNonInvocationUse;
};

// `const load = useCallback(async () => ..., [])` — an empty-deps
// useCallback/useMemo result never changes identity, so a deps array of
// only such bindings is de-facto mount-only. Also covers hooks matching
// STABLE_RESULT_HOOK_PATTERN and stable methods destructured from
// STABLE_METHOD_HOOKS results.
const isStableHookProductBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!doesBindingPatternBindName(declarator.id, bindingName)) continue;
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          const hookCallee = declarator.init.callee;
          if (!isNodeOfType(hookCallee, "Identifier")) continue;
          if (STABLE_RESULT_HOOK_PATTERN.test(hookCallee.name)) return true;
          if (
            STABLE_METHOD_HOOKS.has(hookCallee.name) &&
            isNodeOfType(declarator.id, "ObjectPattern")
          ) {
            return true;
          }
          if (hookCallee.name === "useCallback" || hookCallee.name === "useMemo") {
            const dependencyArgument = declarator.init.arguments?.[1];
            if (
              dependencyArgument &&
              isNodeOfType(dependencyArgument, "ArrayExpression") &&
              (dependencyArgument.elements ?? []).length === 0
            ) {
              return true;
            }
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// `const { identityService } = useQueryContext()` — a dependency bound from
// a context hook and used EXCLUSIVELY as a method-call receiver
// (`identityService.getAuthHeaders()`) is a DI service singleton whose
// identity is stable for the provider's lifetime, so it is de-facto
// mount-only. Data reads (`service.config`) or direct invocation
// (`fetchViews()`) disqualify — those identities carry per-render meaning.
const CONTEXT_HOOK_NAME_PATTERN = /^use(?:[A-Z]\w*)?Context$/;

const isContextHookBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          const hookCallee = declarator.init.callee;
          if (!isNodeOfType(hookCallee, "Identifier")) continue;
          if (!CONTEXT_HOOK_NAME_PATTERN.test(hookCallee.name)) continue;
          if (doesBindingPatternBindName(declarator.id, bindingName)) return true;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const isDependencyOnlyMethodCallReceiver = (
  effectCallback: EsTreeNode,
  bindingName: string,
): boolean => {
  let sawReceiverUse = false;
  let sawOtherUse = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (sawOtherUse) return false;
    if (!isNodeOfType(child, "Identifier") || child.name !== bindingName) return;
    const member = child.parent;
    if (isNodeOfType(member, "MemberExpression") && member.object === child && !member.computed) {
      const memberParent = member.parent;
      if (isNodeOfType(memberParent, "CallExpression") && memberParent.callee === member) {
        sawReceiverUse = true;
        return;
      }
    }
    sawOtherUse = true;
    return false;
  });
  return sawReceiverUse && !sawOtherUse;
};

// A module-scope `const` (or import) has one identity for the module's whole
// lifetime, so it can never re-trigger the effect. Any closer binding of the
// same name (param, local declaration) shadows it and disqualifies the dep.
const isModuleScopeConstBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "ImportDeclaration")) {
          const bindsImportedName = (statement.specifiers ?? []).some((specifier) =>
            doesBindingPatternBindName(specifier.local, bindingName),
          );
          if (bindsImportedName) return true;
        }
        if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
          const bindsConstName = (statement.declarations ?? []).some((declarator) =>
            doesBindingPatternBindName(declarator.id, bindingName),
          );
          if (bindsConstName) return true;
        }
      }
      return false;
    }
    if (isFunctionLike(cursor)) {
      const isShadowedByParam = (cursor.params ?? []).some((param) =>
        doesBindingPatternBindName(param, bindingName),
      );
      if (isShadowedByParam) return false;
    }
    if (isNodeOfType(cursor, "BlockStatement")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "VariableDeclaration")) {
          const isShadowedLocally = (statement.declarations ?? []).some((declarator) =>
            doesBindingPatternBindName(declarator.id, bindingName),
          );
          if (isShadowedLocally) return false;
        }
        if (
          isNodeOfType(statement, "FunctionDeclaration") &&
          isNodeOfType(statement.id, "Identifier") &&
          statement.id.name === bindingName
        ) {
          return false;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// A mount-only effect (empty deps) or one whose deps are all stable-identity
// bindings (useState/useReducer dispatcher, useRef box, external-store action
// reference, module-scope const) can never have overlapping re-runs, so the
// out-of-order stale-write hazard cannot occur.
const hasOnlyStableIdentityDependencies = ({
  dependencyArray,
  effectCallback,
}: {
  dependencyArray: EsTreeNodeOfType<"ArrayExpression">;
  effectCallback: EsTreeNode;
}): boolean =>
  (dependencyArray.elements ?? []).every((dependencyElement) => {
    if (!isNodeOfType(dependencyElement, "Identifier")) return false;
    return (
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STATE_DISPATCHER_HOOKS,
        destructureIndex: 1,
      }) ||
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STABLE_IDENTITY_HOOK,
      }) ||
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STABLE_RESULT_HOOKS,
      }) ||
      isStableHookProductBinding(dependencyArray, dependencyElement.name) ||
      isModuleScopeConstBinding(dependencyArray, dependencyElement.name) ||
      (isExternalStoreHookBinding(dependencyArray, dependencyElement.name) &&
        isDependencyOnlyInvokedInCallback(effectCallback, dependencyElement.name)) ||
      (isContextHookBinding(dependencyArray, dependencyElement.name) &&
        isDependencyOnlyMethodCallReceiver(effectCallback, dependencyElement.name))
    );
  });

const isStateDispatcherCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  return isHookBindingInScope(callExpression, {
    bindingName: callExpression.callee.name,
    hookName: STATE_DISPATCHER_HOOKS,
    destructureIndex: 1,
  });
};

const referencesCancellationGuard = (asyncFunction: EsTreeNode): boolean => {
  let found = false;
  walkAst(asyncFunction, (child: EsTreeNode) => {
    if (found) return false;
    // A `.current` read is the ref-based mounted-guard idiom.
    if (
      (isNodeOfType(child, "Identifier") && CANCELLATION_GUARD_PATTERN.test(child.name)) ||
      (isNodeOfType(child, "MemberExpression") &&
        isNodeOfType(child.property, "Identifier") &&
        child.property.name === "current")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const collectLocalBindingNames = (asyncFunction: EsTreeNode): Set<string> => {
  const localNames = new Set<string>();
  walkAst(asyncFunction, (child: EsTreeNode) => {
    if (isNodeOfType(child, "VariableDeclarator")) {
      collectPatternNames(child.id as EsTreeNode, localNames);
    }
    if (isFunctionLike(child)) {
      for (const parameter of child.params ?? []) {
        collectPatternNames(parameter as EsTreeNode, localNames);
      }
      if (isNodeOfType(child.id, "Identifier")) localNames.add(child.id.name);
    }
    if (isNodeOfType(child, "CatchClause") && child.param) {
      collectPatternNames(child.param as EsTreeNode, localNames);
    }
  });
  return localNames;
};

// Whether any scope between the async function and module scope (component
// body, effect callback, closures) declares the name — i.e. the binding is
// per-render/per-run rather than module-lifetime or global.
const isBoundBetweenScopeAndModule = (asyncFunction: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = asyncFunction.parent;
  while (cursor && !isNodeOfType(cursor, "Program")) {
    if (isFunctionLike(cursor)) {
      const parameterNames = new Set<string>();
      for (const parameter of cursor.params ?? []) {
        collectPatternNames(parameter as EsTreeNode, parameterNames);
      }
      if (parameterNames.has(bindingName)) return true;
    }
    if (isNodeOfType(cursor, "BlockStatement")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "VariableDeclaration")) {
          const declaredNames = new Set<string>();
          for (const declarator of statement.declarations ?? []) {
            collectPatternNames(declarator.id as EsTreeNode, declaredNames);
          }
          if (declaredNames.has(bindingName)) return true;
        }
        if (
          isNodeOfType(statement, "FunctionDeclaration") &&
          isNodeOfType(statement.id, "Identifier") &&
          statement.id.name === bindingName
        ) {
          return true;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// The awaited work reads NOTHING per-render: every free identifier resolves
// to a local, a state setter, a module-scope const/import, or a global.
// Overlapping re-runs then compute the same value, so a late resolution
// writes identical (not stale) state and the out-of-order hazard cannot
// occur (`const label = await referralService.getCustomLauncherLabel()`
// where the dep merely gates whether to fetch). Only applied when an
// explicit deps array exists — an omitted deps array re-runs every render,
// which is its own bug regardless of what the awaited work reads.
const asyncWorkIsPerRenderIndependent = (asyncFunction: EsTreeNode): boolean => {
  const localNames = collectLocalBindingNames(asyncFunction);
  let readsPerRenderValue = false;
  walkAst(asyncFunction, (child: EsTreeNode) => {
    if (readsPerRenderValue) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    if (localNames.has(child.name)) return;
    const parent = child.parent;
    if (parent && typeof parent.type === "string" && parent.type.startsWith("TS")) return;
    if (isNodeOfType(parent, "MemberExpression") && parent.property === child && !parent.computed) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === child &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return;
    }
    if (
      isHookBindingInScope(asyncFunction, {
        bindingName: child.name,
        hookName: STATE_DISPATCHER_HOOKS,
        destructureIndex: 1,
      })
    ) {
      return;
    }
    if (isModuleScopeConstBinding(asyncFunction, child.name)) return;
    if (!isBoundBetweenScopeAndModule(asyncFunction, child.name)) return;
    readsPerRenderValue = true;
    return false;
  });
  return !readsPerRenderValue;
};

const findFirstSuspensionStart = (asyncFunction: EsTreeNode): number | null => {
  let earliestSuspensionStart: number | null = null;
  walkOwnFunctionScope(asyncFunction, (node) => {
    const isSuspensionPoint =
      isNodeOfType(node, "AwaitExpression") ||
      (isNodeOfType(node, "ForOfStatement") && node.await === true);
    if (!isSuspensionPoint) return;
    const start = (node as { start?: unknown }).start;
    if (typeof start !== "number") return;
    if (earliestSuspensionStart === null || start < earliestSuspensionStart) {
      earliestSuspensionStart = start;
    }
  });
  return earliestSuspensionStart;
};

const MERGE_COLLECTION_CONSTRUCTOR_NAMES = new Set(["Map", "Set"]);

// A merge-shaped expression over the previous-state parameter `p`:
// `{ ...p, [k]: v }`, `Object.assign({}, p, ...)`, `new Map(p).set(k, v)` /
// `new Set(p).add(v)`, or `p` itself (bail-out return). All preserve every
// other run's entries, so a late resolution cannot clobber newer state.
// A merge CONSTRUCTION copies prev into a fresh container: `{ ...p, ... }`,
// `Object.assign({}, p, ...)`, `new Map(p)` / `new Set(p)` — optionally
// followed by member calls on the fresh copy (`new Map(p).set(k, v)`).
// Member calls on `p` ITSELF (`p.concat(chunk)`) are not merges: they
// transform stale state directly, the exact streaming hazard the rule
// targets.
const isMergeConstruction = (expression: EsTreeNode, previousStateName: string): boolean => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "ObjectExpression")) {
    return (inner.properties ?? []).some(
      (property) =>
        isNodeOfType(property, "SpreadElement") &&
        isNodeOfType(property.argument, "Identifier") &&
        property.argument.name === previousStateName,
    );
  }
  if (isNodeOfType(inner, "NewExpression")) {
    return (
      isNodeOfType(inner.callee, "Identifier") &&
      MERGE_COLLECTION_CONSTRUCTOR_NAMES.has(inner.callee.name) &&
      (inner.arguments ?? []).some(
        (argument) => isNodeOfType(argument, "Identifier") && argument.name === previousStateName,
      )
    );
  }
  if (isNodeOfType(inner, "CallExpression")) {
    const callee = inner.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Object" &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "assign"
    ) {
      return (inner.arguments ?? []).some(
        (argument) => isNodeOfType(argument, "Identifier") && argument.name === previousStateName,
      );
    }
    if (isNodeOfType(callee, "MemberExpression")) {
      return isMergeConstruction(callee.object as EsTreeNode, previousStateName);
    }
  }
  return false;
};

const isMergeShapedExpression = (expression: EsTreeNode, previousStateName: string): boolean => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "Identifier")) return inner.name === previousStateName;
  return isMergeConstruction(inner, previousStateName);
};

// `setMessages(prev => ({ ...prev, [key]: value }))` — a functional updater
// that MERGES into its own previous-state parameter is order-independent
// cache accumulation: a late resolution adds its own key and cannot clobber
// a newer run's state. Block bodies qualify when EVERY return path yields a
// merge shape (directly, or via a local temp initialized to one). Replace-
// shaped updaters (`() => fetched`) still flag.
const isMergeShapedFunctionalUpdater = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const updater = setterCall.arguments?.[0];
  if (!isFunctionLike(updater)) return false;
  const previousStateParam = updater.params?.[0];
  if (!isNodeOfType(previousStateParam, "Identifier")) return false;
  const previousStateName = previousStateParam.name;
  const body: EsTreeNode = updater.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    return isMergeShapedExpression(body, previousStateName);
  }
  const mergeShapedLocals = new Set<string>();
  const returnArguments: EsTreeNode[] = [];
  let sawNonMergeStructure = false;
  walkOwnFunctionScope(updater, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.init &&
      isMergeShapedExpression(child.init as EsTreeNode, previousStateName)
    ) {
      mergeShapedLocals.add(child.id.name);
    }
    if (isNodeOfType(child, "ReturnStatement")) {
      if (!child.argument) {
        sawNonMergeStructure = true;
        return;
      }
      returnArguments.push(child.argument as EsTreeNode);
    }
  });
  if (sawNonMergeStructure || returnArguments.length === 0) return false;
  return returnArguments.every((argument) => {
    const inner = stripParenExpression(argument);
    if (isNodeOfType(inner, "Identifier") && mergeShapedLocals.has(inner.name)) return true;
    return isMergeShapedExpression(inner, previousStateName);
  });
};

// The awaiting async scope is a stale-write hazard when a state setter
// finishes lexically after the first suspension point (`await` or
// `for await...of`) in that same scope. Comparing the setter's END offset
// also catches `setData(await load())`, where the setter call starts before
// the await nested in its own arguments but still executes after it.
const hasPostAwaitStateSetter = (asyncFunction: EsTreeNode): boolean => {
  const firstSuspensionStart = findFirstSuspensionStart(asyncFunction);
  if (firstSuspensionStart === null) return false;

  let hasLaterSetter = false;
  walkOwnFunctionScope(asyncFunction, (node) => {
    if (hasLaterSetter) return;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (!isStateDispatcherCall(node)) return;
    if (isMergeShapedFunctionalUpdater(node)) return;
    const setterEnd = (node as { end?: unknown }).end;
    if (typeof setterEnd !== "number") return;
    if (setterEnd > firstSuspensionStart) hasLaterSetter = true;
  });
  return hasLaterSetter;
};

// `const [fetching, setFetching] = useState(...)` — resolves the paired
// setter name for a useState VALUE binding.
const findPairedUseStateSetterName = (
  scopeAnchor: EsTreeNode,
  valueName: string,
): string | null => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          const hookCallee = declarator.init.callee;
          if (!isNodeOfType(hookCallee, "Identifier") || hookCallee.name !== "useState") continue;
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const [valueElement, setterElement] = declarator.id.elements ?? [];
          if (
            isNodeOfType(valueElement, "Identifier") &&
            valueElement.name === valueName &&
            isNodeOfType(setterElement, "Identifier")
          ) {
            return setterElement.name;
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const containsBooleanLiteralAssignmentTo = (root: EsTreeNode, bindingName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === bindingName &&
      isNodeOfType(child.right, "Literal") &&
      typeof child.right.value === "boolean"
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// Boolean AND string/number literals qualify — a string status machine
// (`setPhase("running")`) latches with the same concurrency semantics as a
// boolean flag.
const containsSetterCallWithLiteral = (root: EsTreeNode, setterName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName &&
      isNodeOfType(child.arguments?.[0], "Literal")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// `const seq = ++requestSeq; ... if (seq !== requestSeq) return;` — the
// latest-request-wins sequence counter (the rule's own recommended
// remediation, spelled with a module-level counter instead of a ref).
const hasSequenceCounterGuard = (
  asyncFunction: EsTreeNode,
  effectCallback: EsTreeNode,
): boolean => {
  let counterName: string | null = null;
  let snapshotName: string | null = null;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (counterName) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.init &&
      isNodeOfType(child.init, "UpdateExpression") &&
      child.init.operator === "++" &&
      isNodeOfType(child.init.argument, "Identifier")
    ) {
      snapshotName = child.id.name;
      counterName = child.init.argument.name;
      return false;
    }
  });
  if (!counterName || !snapshotName) return false;
  let isGuarded = false;
  walkOwnFunctionScope(asyncFunction, (child: EsTreeNode) => {
    if (isGuarded) return false;
    if (!isNodeOfType(child, "IfStatement") || !isEarlyExitStatement(child.consequent)) return;
    const test = stripParenExpression(child.test as EsTreeNode);
    if (!isNodeOfType(test, "BinaryExpression")) return;
    if (test.operator !== "!==" && test.operator !== "!=") return;
    const names = [test.left, test.right]
      .map((side) => stripParenExpression(side as EsTreeNode))
      .filter((side) => isNodeOfType(side, "Identifier"))
      .map((side) => (side as EsTreeNodeOfType<"Identifier">).name);
    if (names.includes(counterName as string) && names.includes(snapshotName as string)) {
      isGuarded = true;
      return false;
    }
  });
  return isGuarded;
};

// An in-flight mutex whose NAME doesn't match CANCELLATION_GUARD_PATTERN:
// a pre-await early-return `if` reading a binding that is boolean-latched —
// a closure/module `let` assigned boolean literals in the same async
// function (`if (IS_REQUEST_RUNNING) return; IS_REQUEST_RUNNING = true;`),
// or a useState flag whose paired setter is toggled with boolean literals
// (`if (fetching) ...; setFetching(true); await ...`). Either way at most
// one run is ever in flight, so out-of-order stale writes cannot occur.
const scanScopeForLatchBeforeAnchor = ({
  scanScope,
  anchorStart,
  latchAssignmentScope,
  effectCallback,
}: {
  scanScope: EsTreeNode;
  anchorStart: number;
  latchAssignmentScope: EsTreeNode;
  effectCallback: EsTreeNode;
}): boolean => {
  let isLatched = false;
  walkOwnFunctionScope(scanScope, (node) => {
    if (isLatched) return;
    if (!isNodeOfType(node, "IfStatement") || node.alternate) return;
    const start = (node as { start?: unknown }).start;
    const end = (node as { end?: unknown }).end;
    if (typeof start !== "number" || start >= anchorStart) return;
    // Two spellings of the same latch: the guard-clause early exit
    // (`if (busy) return; ... await`) and the wrap-in-if form whose
    // consequent CONTAINS the await (`if (!busy) { setBusy(true); await }`).
    const wrapsSuspension = typeof end === "number" && end > anchorStart;
    if (!wrapsSuspension && !isEarlyExitStatement(node.consequent)) return;
    walkAst(node.test as EsTreeNode, (testChild: EsTreeNode) => {
      if (isLatched) return false;
      if (!isNodeOfType(testChild, "Identifier")) return;
      const parent = testChild.parent;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.property === testChild &&
        !parent.computed
      ) {
        return;
      }
      if (containsBooleanLiteralAssignmentTo(latchAssignmentScope, testChild.name)) {
        isLatched = true;
        return false;
      }
      const setterName = findPairedUseStateSetterName(latchAssignmentScope, testChild.name);
      if (setterName && containsSetterCallWithLiteral(effectCallback, setterName)) {
        isLatched = true;
        return false;
      }
    });
  });
  return isLatched;
};

const hasPreAwaitEarlyReturnLatch = (
  asyncFunction: EsTreeNode,
  effectCallback: EsTreeNode,
): boolean => {
  const firstSuspensionStart = findFirstSuspensionStart(asyncFunction);
  if (firstSuspensionStart === null) return false;
  return scanScopeForLatchBeforeAnchor({
    scanScope: asyncFunction,
    anchorStart: firstSuspensionStart,
    latchAssignmentScope: asyncFunction,
    effectCallback,
  });
};

// The latch can also live in the effect callback AROUND the async function
// (`if (!loadingResource && ...) { loadingResource = true; ... run() }`) —
// the module-let mutex checked and set synchronously before the async work
// starts, so at most one run is ever in flight.
const hasEffectCallbackLatch = (asyncFunction: EsTreeNode, effectCallback: EsTreeNode): boolean => {
  const asyncFunctionStart = (asyncFunction as { start?: unknown }).start;
  if (typeof asyncFunctionStart !== "number") return false;
  return scanScopeForLatchBeforeAnchor({
    scanScope: effectCallback,
    anchorStart: asyncFunctionStart,
    latchAssignmentScope: effectCallback,
    effectCallback,
  });
};

export const noSetStateAfterAwaitInEffect = defineRule({
  id: "no-set-state-after-await-in-effect",
  title: "State update after await in an effect",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "In a `useEffect` whose dependencies can change, guard any setter call that runs after an `await` behind a cancellation/ignore flag, or return a cleanup that cancels the async work.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!isFunctionLike(callback)) return;
      // Async effect callbacks are owned by `no-async-effect-callback`.
      if (callback.async) return;
      const dependencyArray = getDependencyArray(node);
      if (
        dependencyArray &&
        hasOnlyStableIdentityDependencies({ dependencyArray, effectCallback: callback })
      ) {
        return;
      }
      // A cleanup return is the documented fix; stay quiet when one exists.
      if (functionBodyHasReturnWithValue(callback)) return;

      // Guard idioms may live in the callback's synchronous prologue
      // (`if (handledRef.current) return; handledRef.current = true;`)
      // rather than inside the inner async function, so scan the whole
      // effect callback, not each async scope in isolation.
      if (referencesCancellationGuard(callback)) return;

      const asyncFunctions: EsTreeNode[] = [];
      walkAst(callback, (child: EsTreeNode) => {
        if (child === callback) return;
        if (isFunctionLike(child) && child.async) asyncFunctions.push(child);
      });

      for (const asyncFunction of asyncFunctions) {
        if (hasPreAwaitEarlyReturnLatch(asyncFunction, callback)) continue;
        if (hasEffectCallbackLatch(asyncFunction, callback)) continue;
        if (hasSequenceCounterGuard(asyncFunction, callback)) continue;
        if (dependencyArray && asyncWorkIsPerRenderIndependent(asyncFunction)) continue;
        if (hasPostAwaitStateSetter(asyncFunction)) {
          context.report({ node, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
