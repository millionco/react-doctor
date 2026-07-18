import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

type IsPropNameFn = (name: string, referenceNode?: EsTreeNode) => boolean;

// Names the shared initial-only helper misses but that carry the same
// "seed once, then uncontrolled" contract: a prop literally named
// `initial`, `initiallyOpen`, `autoFocus`/`autoPlay` (start-state flags),
// `startOpen`.
const isInitialOnlySeedName = (propName: string): boolean =>
  isInitialOnlyPropName(propName) ||
  propName === "initial" ||
  propName === "autoFocus" ||
  propName === "autoPlay" ||
  propName === "startOpen" ||
  /^initially[A-Z]/.test(propName) ||
  /Initial([A-Z]|$)/.test(propName);

// State names that announce snapshot / intentional-lag semantics:
// `previousActiveTabId` stores history, `preservedSelection` deliberately
// pins the first value, `debouncedUrl` lags the prop by design. The
// "staleness" is the feature, not a bug.
const SNAPSHOT_STATE_NAME_PATTERN =
  /^(initial|previous|prev|preserved|saved|original|cached|snapshot|prior|debounced|deferred)([A-Z_]|$)/;

const getStateSetterName = (useStateCall: EsTreeNodeOfType<"CallExpression">): string | null => {
  const declarator = useStateCall.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const setterElement = declarator.id.elements?.[1];
  if (!isNodeOfType(setterElement, "Identifier")) return null;
  return setterElement.name;
};

// `const [initialStep] = useState(activeStep)` — a snapshot-named binding
// declares that holding the first value is the point (history, debounce
// lag, preservation), so the "staleness" is the feature.
const isIntentionalSnapshotState = (useStateCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const declarator = useStateCall.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const valueElement = (declarator.id.elements ?? [])[0];
  return (
    isNodeOfType(valueElement, "Identifier") && SNAPSHOT_STATE_NAME_PATTERN.test(valueElement.name)
  );
};

// The seed expression a useState initializer copies from, seen through
// assertion wrappers: `useState(providers?.[0])` and `useState(value as
// string)` copy the underlying prop once. Defaulting expressions
// (`useState(value || null)`, `useState(x ?? fallback)`) are OUT of the
// rule's documented scope — the doc limits detection to direct Identifier
// and member-expression initializers, and coalescing seeds mark the
// intentional "default the user then edits" pattern.
const unwrapInitializerSeed = (initializer: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode = initializer;
  for (;;) {
    if (isNodeOfType(current, "ChainExpression") || isNodeOfType(current, "TSNonNullExpression")) {
      current = current.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(current, "TSAsExpression") || isNodeOfType(current, "TSSatisfiesExpression")) {
      current = current.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(current, "UnaryExpression") && current.operator === "!") {
      current = current.argument as EsTreeNode;
      continue;
    }
    if (
      isNodeOfType(current, "TemplateLiteral") &&
      (current.expressions ?? []).length === 1 &&
      (current.quasis ?? []).every((quasi) => quasi.value?.raw === "")
    ) {
      current = current.expressions[0] as EsTreeNode;
      continue;
    }
    return current;
  }
};

const isPropDerivedArgument = (
  argument: EsTreeNode | null | undefined,
  isPropName: IsPropNameFn,
): boolean => {
  if (!argument) return false;
  if (isNodeOfType(argument, "Identifier")) return isPropName(argument.name, argument);
  if (isNodeOfType(argument, "MemberExpression")) {
    const rootIdentifierName = getRootIdentifierName(argument);
    return rootIdentifierName !== null && isPropName(rootIdentifierName, argument);
  }
  return false;
};

const getArgumentRootName = (argument: EsTreeNode | null | undefined): string | null => {
  if (!argument) return null;
  if (isNodeOfType(argument, "Identifier")) return argument.name;
  if (isNodeOfType(argument, "MemberExpression")) return getRootIdentifierName(argument);
  return null;
};

// `onClick={() => { setDraft(headerTitle); startRenaming(); }}` reseeds the
// draft from a component-scope binding (often a prop post-processed into a
// local). A root bound by a NESTED function's own params (`(e) =>
// setDraft(e.target.value)`) is user input, which proves nothing about
// reseeding.
const isComponentScopeValueArgument = (
  setterCall: EsTreeNode,
  componentFunction: EsTreeNode,
  argument: EsTreeNode | null | undefined,
): boolean => {
  const rootName = getArgumentRootName(argument);
  if (rootName === null) return false;
  let cursor: EsTreeNode | null = setterCall.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor)) {
      const nestedParamNames = new Set<string>();
      for (const param of cursor.params ?? []) {
        collectPatternNames(param, nestedParamNames);
      }
      if (nestedParamNames.has(rootName)) return false;
    }
    cursor = cursor.parent ?? null;
  }
  return true;
};

// `if (open && !mounted) setMounted(true)` — a render-phase adjust whose
// guard compares against the state itself is the documented
// "adjust state during render" pattern even when the assigned value is a
// constant; the guard proves the state converges instead of going stale.
const isGuardedByStateReference = (
  setterCall: EsTreeNode,
  componentFunction: EsTreeNode,
  stateValueName: string | null,
): boolean => {
  if (!stateValueName) return false;
  let cursor: EsTreeNode | null = setterCall.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    const test =
      isNodeOfType(cursor, "IfStatement") || isNodeOfType(cursor, "ConditionalExpression")
        ? cursor.test
        : null;
    if (test) {
      let referencesState = false;
      walkAst(test as EsTreeNode, (child) => {
        if (referencesState) return false;
        if (isNodeOfType(child, "Identifier") && child.name === stateValueName) {
          referencesState = true;
          return false;
        }
      });
      if (referencesState) return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const EFFECT_HOOK_NAME_PATTERN = /^use([A-Z].*)?Effect$/;

// A component that can dismiss itself (`onClose` / `onCancel` /
// `onOpenChange` / `onDismiss`) is a modal-session UI: it mounts fresh per
// open, edits a draft, and commits on save. Copying a prop into state there
// is the intentional draft pattern — the prop cannot meaningfully change
// during the session, so no stale value is ever shown.
const SESSION_DISMISS_PROP_NAMES: ReadonlySet<string> = new Set([
  "onClose",
  "onCancel",
  "onOpenChange",
  "onDismiss",
]);

const hasSessionDismissProp = (propNames: Set<string>): boolean => {
  for (const dismissName of SESSION_DISMISS_PROP_NAMES) {
    if (propNames.has(dismissName)) return true;
  }
  return false;
};

const getEnclosingEffectHookCallback = (
  node: EsTreeNode,
  componentFunction: EsTreeNode,
): EsTreeNode | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor)) {
      const parent = cursor.parent ?? null;
      if (parent && isNodeOfType(parent, "CallExpression")) {
        const calleeName = getCalleeName(parent);
        if (
          calleeName !== null &&
          EFFECT_HOOK_NAME_PATTERN.test(calleeName) &&
          (parent.arguments ?? []).some((argument) => argument === cursor)
        ) {
          return cursor;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// Any effect-driven setter call keeps the state re-synced, so the "copies
// it once, users see a stale value" report is wrong. The unconditional
// top-of-effect `setX(prop)` mirror is `no-mirror-prop-effect`'s single,
// more actionable diagnostic — double-reporting it here with a false
// staleness claim helps nobody.
const isEffectDrivenResync = (useStateCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const setterName = getStateSetterName(useStateCall);
  if (!setterName) return false;
  const componentFunction = findEnclosingFunction(useStateCall);
  if (!componentFunction) return false;

  let isExempt = false;
  walkAst(componentFunction, (child) => {
    if (isExempt) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier") || child.callee.name !== setterName) return;
    if (!getEnclosingEffectHookCallback(child, componentFunction)) return;
    isExempt = true;
    return false;
  });
  return isExempt;
};

// `({ language = 'markdown' }) => useState(language)` — a destructured
// prop WITH a default is optional config, and seeding local user-editable
// state from it is the doc's intentionally-uncontrolled "default value the
// user then edits" pattern.
const isDefaultedDestructuredProp = (
  componentFunction: EsTreeNode,
  propRootName: string,
): boolean => {
  let hasDefault = false;
  for (const param of (componentFunction as { params?: EsTreeNode[] }).params ?? []) {
    walkAst(param, (node) => {
      if (hasDefault) return false;
      if (
        isNodeOfType(node, "AssignmentPattern") &&
        isNodeOfType(node.left, "Identifier") &&
        node.left.name === propRootName
      ) {
        hasDefault = true;
        return false;
      }
    });
  }
  return hasDefault;
};

// `handleSubmit = () => onChange(selectedAddress)` — the draft state is
// committed back to the parent through a prop callback, so the parent stays
// the source of truth and the local copy is an intentional working buffer.
const isDraftCommittedToParent = (
  componentFunction: EsTreeNode,
  stateValueName: string | null,
  isPropName: IsPropNameFn,
): boolean => {
  if (!stateValueName) return false;
  let isCommitted = false;
  walkAst(componentFunction, (child) => {
    if (isCommitted) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (!isPropName(child.callee.name, child.callee)) return;
    for (const argument of child.arguments ?? []) {
      const argumentRootName = getRootIdentifierName(argument, { followCallChains: true });
      if (argumentRootName === stateValueName && !isInRenderScope(child, componentFunction)) {
        isCommitted = true;
        return false;
      }
    }
  });
  return isCommitted;
};

const NEXTJS_PAGE_DATA_EXPORT_NAMES = new Set(["getServerSideProps", "getStaticProps"]);

// A Next.js pages-router page gets its props from getServerSideProps /
// getStaticProps: they are fixed for the page instance (navigation
// remounts), so `useState(props.x)` is the canonical
// initialize-from-server-props capture, never a stale mirror.
const isNextjsDataFetchingPage = (node: EsTreeNode): boolean => {
  const program = findProgramRoot(node);
  if (!program) return false;
  for (const statement of program.body ?? []) {
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    const declaration = statement.declaration;
    if (isNodeOfType(declaration, "FunctionDeclaration")) {
      if (declaration.id && NEXTJS_PAGE_DATA_EXPORT_NAMES.has(declaration.id.name)) return true;
      continue;
    }
    if (isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations ?? []) {
        if (
          isNodeOfType(declarator.id, "Identifier") &&
          NEXTJS_PAGE_DATA_EXPORT_NAMES.has(declarator.id.name)
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

const isNonHandlerHookCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent ?? null;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!(parent.arguments ?? []).some((argument) => argument === functionNode)) return false;
  const calleeName = getCalleeName(parent);
  return calleeName !== null && isReactHookName(calleeName) && calleeName !== "useCallback";
};

// A re-seed only counts when every function between the setter call and the
// component is handler-shaped: a plain nested function or a `useCallback`
// callback. Any other hook callback — `useEffect`, `useMemo`, or a custom
// effect wrapper like `useUpdateEffect` — is a genuine prop mirror, not a
// user-triggered draft reset.
const isHandlerShapedReseed = (setterCall: EsTreeNode, componentFunction: EsTreeNode): boolean => {
  let hasNestedFunction = false;
  let cursor: EsTreeNode | null = setterCall.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor)) {
      hasNestedFunction = true;
      if (isNonHandlerHookCallback(cursor)) return false;
    }
    cursor = cursor.parent ?? null;
  }
  return hasNestedFunction;
};

// True when no function boundary sits between `node` and the component —
// i.e. the call runs during render, not inside a nested handler/callback.
const isInRenderScope = (node: EsTreeNode, componentFunction: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor)) return false;
    cursor = cursor.parent ?? null;
  }
  return true;
};

// Two exemptions, one walk (they look for the same prop-derived setter call
// and differ only in where it sits):
//   - Draft buffer: the re-seed lives in a NESTED handler (e.g.
//     `edit = () => setTitle(props.title)` on entering rename mode) and
//     commits via a callback — the prop stays the source of truth, so
//     `useState(prop)` holds intentional decoupled user-edit text, not a
//     stale mirror. A re-seed in an effect or memo is a genuine mirror.
//   - Adjust-during-render: the "store information from previous renders"
//     pattern re-syncs during render (`if (prop !== prev) setPrev(prop)`), so
//     the value is never stale. React endorses this over a mirroring effect.
//     The render-phase call must pass a prop-derived argument: a render-phase
//     reset to an unrelated constant leaves the stale copy and keeps the report.
const getStateValueName = (useStateCall: EsTreeNodeOfType<"CallExpression">): string | null => {
  const declarator = useStateCall.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const valueElement = declarator.id.elements?.[0];
  if (!isNodeOfType(valueElement, "Identifier")) return null;
  return valueElement.name;
};

// A functional updater driven by a periodic hook callback
// (`useInterval(() => setFake(prev => ...))`) evolves the state from its
// previous value — machine-driven state, not a copy of the prop.
const isHookDrivenFunctionalUpdate = (
  setterCall: EsTreeNode,
  componentFunction: EsTreeNode,
  argument: EsTreeNode | null | undefined,
): boolean => {
  if (!argument || !isFunctionLike(argument)) return false;
  let cursor: EsTreeNode | null = setterCall.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor) && isNonHandlerHookCallback(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const isDraftReseedOrRenderAdjusted = (
  useStateCall: EsTreeNodeOfType<"CallExpression">,
  isPropName: IsPropNameFn,
): boolean => {
  const setterName = getStateSetterName(useStateCall);
  if (!setterName) return false;
  const stateValueName = getStateValueName(useStateCall);
  const componentFunction = findEnclosingFunction(useStateCall);
  if (!componentFunction) return false;

  let isExempt = false;
  walkAst(componentFunction, (child) => {
    if (isExempt) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isNodeOfType(child.callee, "Identifier") ||
      child.callee.name !== setterName
    ) {
      return;
    }
    const argument = child.arguments?.[0];
    const isPropDerived = isPropDerivedArgument(argument, isPropName);
    if (isHandlerShapedReseed(child, componentFunction)) {
      if (isPropDerived || isComponentScopeValueArgument(child, componentFunction, argument)) {
        isExempt = true;
        return false;
      }
    }
    if (isInRenderScope(child, componentFunction)) {
      if (isPropDerived || isGuardedByStateReference(child, componentFunction, stateValueName)) {
        isExempt = true;
        return false;
      }
    }
    if (isHookDrivenFunctionalUpdate(child, componentFunction, argument)) {
      isExempt = true;
      return false;
    }
  });
  return isExempt;
};

export const noDerivedUseState = defineRule({
  id: "no-derived-useState",
  title: "Prop derived into useState",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Compute the value inline so prop changes do not leave `useState` holding a stale copy.",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactHookCall(node, "useState", context.scopes) || !node.arguments?.length) return;
        const seed = unwrapInitializerSeed(node.arguments[0]);

        const reportStalePropCopy = (propName: string): void => {
          if (isIntentionalSnapshotState(node)) return;
          if (hasSessionDismissProp(propStackTracker.getCurrentPropNames())) return;
          if (isDraftReseedOrRenderAdjusted(node, propStackTracker.isPropName)) return;
          if (isEffectDrivenResync(node)) return;
          if (isNextjsDataFetchingPage(node)) return;
          const componentFunction = findEnclosingFunction(node);
          if (componentFunction) {
            if (isDefaultedDestructuredProp(componentFunction, propName)) return;
            if (
              isDraftCommittedToParent(
                componentFunction,
                getStateValueName(node),
                propStackTracker.isPropName,
              )
            ) {
              return;
            }
          }
          context.report({
            node,
            message: `Your users see a stale value when prop "${propName}" changes because useState copies it once.`,
          });
        };

        if (isNodeOfType(seed, "Identifier") && propStackTracker.isPropName(seed.name)) {
          if (isInitialOnlySeedName(seed.name)) return;
          reportStalePropCopy(seed.name);
          return;
        }

        if (isNodeOfType(seed, "MemberExpression")) {
          const rootIdentifierName = getRootIdentifierName(seed);
          if (rootIdentifierName && propStackTracker.isPropName(rootIdentifierName)) {
            // Initial-only names exempt the whole chain from either end:
            // `props.initialValue` (last property) and `initialShipping.city`
            // (root binding) both signal a deliberate one-shot seed.
            if (
              !seed.computed &&
              isNodeOfType(seed.property, "Identifier") &&
              isInitialOnlySeedName(seed.property.name)
            ) {
              return;
            }
            if (isInitialOnlySeedName(rootIdentifierName)) return;
            reportStalePropCopy(rootIdentifierName);
          }
        }
      },
    };
  },
});
