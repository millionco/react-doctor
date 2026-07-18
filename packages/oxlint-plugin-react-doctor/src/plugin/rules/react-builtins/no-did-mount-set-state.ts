import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const LIFECYCLE_NAMES = new Set(["componentDidMount"]);
const MESSAGE =
  "Your users see an extra render right after mount when you call `setState` in `componentDidMount`.";

const getEnclosingLifecycleFunction = (setStateCall: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const parent = ancestor.parent;
      if (
        (isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "Property")) &&
        isNodeOfType(parent.key, "Identifier") &&
        LIFECYCLE_NAMES.has(parent.key.name)
      ) {
        return ancestor;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// `this.setState({ hasMounted: true })` — flipping a boolean flag to `true`
// right after mount is the deliberate two-pass render pattern (hydration
// gates, enter animations): the second render IS the point, and no initial
// state or getDerivedStateFromProps can replace it.
const isMountFlagArgument = (argument: EsTreeNode | undefined): boolean => {
  if (!argument || !isNodeOfType(argument, "ObjectExpression")) return false;
  const properties = argument.properties ?? [];
  if (properties.length === 0) return false;
  return properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      property.computed !== true &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === true,
  );
};

// Sources whose values genuinely cannot exist before mount — the doc's
// explicit carve-out ("reserve componentDidMount setState for values that
// can only exist post-mount, e.g. a measured DOM size").
const POST_MOUNT_MEMBER_NAMES = new Set([
  "current",
  "textContent",
  "innerText",
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "clientWidth",
  "clientHeight",
  "scrollWidth",
  "scrollHeight",
  "scrollTop",
  "scrollLeft",
  "getBoundingClientRect",
]);
const OBSERVER_CONSTRUCTOR_PATTERN = /Observer$/;

const containsPostMountSource = (node: EsTreeNode): boolean => {
  let didFindSource = false;
  walkAst(node, (descendant) => {
    if (didFindSource) return false;
    if (
      isNodeOfType(descendant, "NewExpression") &&
      isNodeOfType(descendant.callee, "Identifier") &&
      OBSERVER_CONSTRUCTOR_PATTERN.test(descendant.callee.name)
    ) {
      didFindSource = true;
      return false;
    }
    if (
      isNodeOfType(descendant, "MemberExpression") &&
      isNodeOfType(descendant.property, "Identifier") &&
      descendant.computed !== true &&
      POST_MOUNT_MEMBER_NAMES.has(descendant.property.name)
    ) {
      didFindSource = true;
      return false;
    }
  });
  return didFindSource;
};

const collectReferencedNames = (node: EsTreeNode, into: Set<string>): void => {
  walkAst(node, (descendant) => {
    if (!isNodeOfType(descendant, "Identifier")) return;
    const parent = descendant.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.property === descendant &&
      parent.computed !== true
    ) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === descendant &&
      parent.value !== descendant
    ) {
      return;
    }
    into.add(descendant.name);
  });
};

// True when the setState argument reads a post-mount-only source directly,
// or references a local declared in the lifecycle body whose initializer
// (transitively) does — `const el = this.ref.current; const z = calc(el);
// this.setState({ z })`.
const argumentDerivesFromPostMountSource = (
  setStateCall: EsTreeNodeOfType<"CallExpression">,
  lifecycleFunction: EsTreeNode,
): boolean => {
  const argumentNodes = setStateCall.arguments ?? [];
  if (argumentNodes.length === 0) return false;
  if (argumentNodes.some((argument) => containsPostMountSource(argument))) return true;

  const localInitializers = new Map<string, EsTreeNode>();
  walkAst(lifecycleFunction, (descendant) => {
    if (
      isNodeOfType(descendant, "VariableDeclarator") &&
      isNodeOfType(descendant.id, "Identifier") &&
      descendant.init
    ) {
      localInitializers.set(descendant.id.name, descendant.init);
    }
  });
  if (localInitializers.size === 0) return false;

  const reachedNames = new Set<string>();
  for (const argument of argumentNodes) collectReferencedNames(argument, reachedNames);
  const pendingNames = [...reachedNames];
  while (pendingNames.length > 0) {
    const name = pendingNames.pop();
    if (name === undefined) break;
    const initializer = localInitializers.get(name);
    if (!initializer) continue;
    if (containsPostMountSource(initializer)) return true;
    const referencedNames = new Set<string>();
    collectReferencedNames(initializer, referencedNames);
    for (const referencedName of referencedNames) {
      if (reachedNames.has(referencedName)) continue;
      reachedNames.add(referencedName);
      pendingNames.push(referencedName);
    }
  }
  return false;
};

// A setState after an `await` in an async componentDidMount is the
// promise-buried case: the continuation runs as a microtask callback, the
// same shape as `.then(() => this.setState(...))`, which the default
// "allowed" mode documents as NOT firing.
const isAfterAwaitInAsyncLifecycle = (
  setStateCall: EsTreeNode,
  lifecycleFunction: EsTreeNode,
): boolean => {
  if (!isFunctionLike(lifecycleFunction) || lifecycleFunction.async !== true) return false;
  const callStart = getNodeStartIndex(setStateCall);
  if (callStart < 0) return false;
  let didFindPrecedingAwait = false;
  walkAst(lifecycleFunction, (descendant) => {
    if (didFindPrecedingAwait) return false;
    if (!isNodeOfType(descendant, "AwaitExpression")) return;
    const awaitStart = getNodeStartIndex(descendant);
    if (awaitStart >= 0 && awaitStart < callStart) {
      didFindPrecedingAwait = true;
      return false;
    }
  });
  return didFindPrecedingAwait;
};

interface NoDidMountSetStateSettings {
  mode?: "allowed" | "disallow-in-func";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoDidMountSetStateSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noDidMountSetState?: NoDidMountSetStateSettings }).noDidMountSetState ??
        {})
      : {};
  return { mode: ruleSettings.mode ?? "allowed" };
};

// Port of `oxc_linter::rules::react::no_did_mount_set_state`. Flags
// `this.setState(...)` directly inside a `componentDidMount` lifecycle
// (default), or inside any nested function within `componentDidMount`
// when `mode: "disallow-in-func"`.
export const noDidMountSetState = defineRule({
  id: "no-did-mount-set-state",
  title: "setState in componentDidMount",
  severity: "warn",
  recommendation:
    "Setting state in `componentDidMount` triggers an extra render. Use `getDerivedStateFromProps` or initial state instead.",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(stripParenExpression(node.callee.object), "ThisExpression")) return;
        if (
          !isNodeOfType(node.callee.property, "Identifier") ||
          node.callee.property.name !== "setState"
        ) {
          return;
        }
        const shouldFlag = isSetStateCallInLifecycle(node, LIFECYCLE_NAMES, {
          disallowInNestedFunctions: mode === "disallow-in-func",
        });
        if (!shouldFlag) return;
        if (isMountFlagArgument(node.arguments?.[0])) return;
        const lifecycleFunction = getEnclosingLifecycleFunction(node);
        if (lifecycleFunction) {
          if (isAfterAwaitInAsyncLifecycle(node, lifecycleFunction)) return;
          if (argumentDerivesFromPostMountSource(node, lifecycleFunction)) return;
        }
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
