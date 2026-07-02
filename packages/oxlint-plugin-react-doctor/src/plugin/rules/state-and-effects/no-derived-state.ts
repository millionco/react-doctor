import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getArgsUpstreamRefs, getCallExpr, getUpstreamRefs } from "./utils/effect/ast.js";
import { isEventHandlerName } from "./utils/event-handler-reference.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  hasCleanup,
  isProp,
  isState,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// 1:1 port of upstream
// `eslint-plugin-react-you-might-not-need-an-effect/src/rules/no-derived-state.js`.
// Diagnostic messages match upstream verbatim. The ESLint scope APIs
// upstream uses (`context.sourceCode.getScope`, `ref.resolved.defs`)
// are sourced from a cached eslint-scope `ScopeManager` via
// `getProgramAnalysis(node)`.

const countSetterCallSites = (ref: Reference): number => {
  if (!ref.resolved) return 0;
  let count = 0;
  for (const reference of ref.resolved.references) {
    const parent = (reference.identifier as unknown as { parent?: EsTreeNode | null }).parent;
    if (parent && isNodeOfType(parent, "CallExpression")) count += 1;
  }
  return count;
};

const getStateNameForUseStateDecl = (useStateNode: EsTreeNode | null): string | null => {
  if (!useStateNode || !isNodeOfType(useStateNode, "VariableDeclarator")) return null;
  if (!isNodeOfType(useStateNode.id, "ArrayPattern")) return null;
  const elements = useStateNode.id.elements ?? [];
  const candidate = elements[0] ?? elements[1];
  if (!candidate) return null;
  return isNodeOfType(candidate, "Identifier") ? candidate.name : null;
};

export const noDerivedState = defineRule({
  id: "no-derived-state",
  title: "Derived value copied into state",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Work out the value while rendering (or with useMemo if it's expensive) instead of copying it into useState through a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;

        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        const useStateNode = getUseStateDecl(analysis, ref);
        const stateName = getStateNameForUseStateDecl(useStateNode) ?? "<state>";

        const argsUpstreamRefs = getArgsUpstreamRefs(analysis, ref);
        const depsUpstreamRefs: Reference[] = depsRefs.flatMap((depRef) =>
          getUpstreamRefs(analysis, depRef),
        );

        // Initial-only / default / seed prop pattern. When the
        // setter receives EXACTLY one arg that IS a bare prop
        // identifier whose name signals init-only intent
        // (`initialValue`, `defaultX`, `seedY`, etc.), the consumer
        // is intentionally re-syncing on a controlled-init prop —
        // `useState(initialValue) + useEffect(() => setX(initialValue), [initialValue])`
        // to rebind on explicit "reset". Strict shape: avoids
        // `.every([]) === true` and AST-shape false-positives.
        if (isInitialOnlySetterCall(callExpr)) continue;

        // Controlled-value mirror whose state stays user-editable through a
        // child: the effect re-syncs state to a bare prop (`setValue(color)`)
        // AND the same setter is handed to a child as an `on*` JSX callback
        // (`onChange={setValue}`), so the state buffers the child's live
        // edits — deriving it while rendering would drop them. Both signals
        // are required: a prop mirror whose setter is merely also called from
        // a handler body is the rule's canonical positive and must report.
        if (
          isBarePropMirrorCall(analysis, callExpr, argsUpstreamRefs) &&
          isSetterPassedAsJsxEventHandler(ref)
        ) {
          continue;
        }

        const isSomeArgsInternal = argsUpstreamRefs.some(
          (argRef) => isState(analysis, argRef) || isProp(analysis, argRef),
        );

        const isAllArgsInDeps =
          argsUpstreamRefs.length > 0 &&
          argsUpstreamRefs.every((argRef) =>
            depsUpstreamRefs.some((depRef) => argRef.resolved === depRef.resolved),
          );
        const isValueAlwaysInSync = isAllArgsInDeps && countSetterCallSites(ref) === 1;

        if (isSomeArgsInternal) {
          context.report({
            node: callExpr,
            message: `Storing "${stateName}" in state when you can derive it from other values costs an extra render.`,
          });
        } else if (isValueAlwaysInSync) {
          context.report({
            node: callExpr,
            message: `"${stateName}" is only set here from other values, so storing it costs an extra render.`,
          });
        }
      }
    },
  }),
});

// `setX(someProp)` — sole argument is a bare identifier that resolves to a
// prop (directly or through a destructuring alias).
const isBarePropMirrorCall = (
  analysis: ProgramAnalysis,
  callExpr: EsTreeNode,
  argsUpstreamRefs: readonly Reference[],
): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const args = callExpr.arguments ?? [];
  if (args.length !== 1) return false;
  const soleArg = args[0] as EsTreeNode;
  if (!isNodeOfType(soleArg, "Identifier")) return false;
  return argsUpstreamRefs.some((argRef) => isProp(analysis, argRef));
};

// The setter itself is the value of an `on*` JSX attribute
// (`onChange={setValue}`) — the child gets direct write access to the state.
const isSetterPassedAsJsxEventHandler = (setterRef: Reference): boolean =>
  Boolean(
    setterRef.resolved?.references.some((reference) => {
      const identifierParent = (reference.identifier as unknown as { parent?: EsTreeNode | null })
        .parent;
      if (!identifierParent || !isNodeOfType(identifierParent, "JSXExpressionContainer")) {
        return false;
      }
      const attribute = identifierParent.parent;
      if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
      const attributeName = getJsxAttributeName(attribute.name);
      return Boolean(attributeName && isEventHandlerName(attributeName));
    }),
  );

// `setX(initialValue)` — sole argument is a bare identifier whose name
// signals the consumer's controlled-init / reset intent.
const isInitialOnlySetterCall = (callExpr: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const args = callExpr.arguments ?? [];
  if (args.length !== 1) return false;
  const arg = args[0] as EsTreeNode;
  if (!isNodeOfType(arg, "Identifier")) return false;
  return isInitialOnlyPropName(arg.name);
};
