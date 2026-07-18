import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { unwrapDiscardedExpression } from "../../utils/unwrap-discarded-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// HACK: §1 of "You Might Not Need an Effect" — mirroring a prop into
// local state with a useEffect that re-syncs it. The combined shape
// is the most common form of derived-state-effect in real codebases:
//
//   function Form({ value }) {
//     const [draft, setDraft] = useState(value);
//     useEffect(() => { setDraft(value); }, [value]);
//     // ...
//   }
//
// Both `noDerivedStateEffect` and `noDerivedUseState` independently
// nudge at parts of this. This rule produces a single, more
// actionable diagnostic that names the prop and recommends deleting
// both the useState and the effect.
//
// Detector pre-conditions:
//   (1) `[X, setX] = useState(<propExpr>)` where <propExpr> is a
//       prop Identifier or a MemberExpression rooted in a prop
//   (2) `useEffect(() => setX(<propExpr'>), [<propRoot>])` where
//       <propExpr'> is structurally identical to <propExpr> from (1)
// Follow call chains so a prop-rooted method call counts:
// `useState(value.toUpperCase())` resolves to root "value". Safe for
// mirror-detection because the structural-equality check on the setter
// argument still requires the SAME call shape — it won't match
// `setX(value.toLowerCase())`.
const getPropRootName = (
  expression: EsTreeNode | null | undefined,
  propNames: Set<string>,
): string | null => {
  const rootName = getRootIdentifierName(expression, {
    followCallChains: true,
  });
  return rootName !== null && propNames.has(rootName) ? rootName : null;
};

interface MirrorBinding {
  valueName: string;
  setterName: string;
  initializer: EsTreeNode;
  propRootName: string;
}

// Docs-validation r2 FP (EditorialCheckCard):
// `useEffect(() => setDraft(value), [value, resetNonce])` — the extra
// dep is a deliberate second re-seed trigger (revert-after-failed-save
// nonce), which is the doc's stated exemption: "a transient local edit
// that is intentionally re-synced to the prop on a separate trigger".
// A pure mirror re-syncs only when the mirrored prop changes; an
// unused extra dep is never demanded by exhaustive-deps, so its
// presence means the author wired a separate trigger. The setter
// itself is exempt (`[value, setValue]` is lint appeasement, not a
// trigger).
const hasOnlyMirrorDeps = (
  depIdentifierNames: ReadonlySet<string>,
  binding: MirrorBinding,
): boolean => {
  for (const depName of depIdentifierNames) {
    if (depName !== binding.propRootName && depName !== binding.setterName) return false;
  }
  return true;
};

export const noMirrorPropEffect = defineRule({
  id: "no-mirror-prop-effect",
  title: "Prop mirrored into state via effect",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Delete both the `useState` and the `useEffect` and read the prop directly while rendering. Copying a prop into state shows the old value on the first render before the effect catches up.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const propNames = propStackTracker.getCurrentPropNames();
      if (propNames.size === 0) return;

      const mirrorBindings: MirrorBinding[] = [];

      for (const statement of componentBody.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const elements = declarator.id.elements ?? [];
          if (elements.length < 2) continue;
          const valueElement = elements[0];
          const setterElement = elements[1];
          if (
            !isNodeOfType(valueElement, "Identifier") ||
            !isNodeOfType(setterElement, "Identifier") ||
            !isSetterIdentifier(setterElement.name)
          ) {
            continue;
          }
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          if (!isReactHookCall(declarator.init, "useState", context.scopes)) continue;
          const initializer = declarator.init.arguments?.[0];
          if (!initializer) continue;
          const propRootName = getPropRootName(initializer, propNames);
          if (!propRootName) continue;
          mirrorBindings.push({
            valueName: valueElement.name,
            setterName: setterElement.name,
            initializer,
            propRootName,
          });
        }
      }

      if (mirrorBindings.length === 0) return;

      // HACK: only consider useEffects that are direct top-level
      // statements of the component body. A useEffect inside a nested
      // helper is a rules-of-hooks violation and isn't part of this
      // component's surface — its outer prop set wouldn't apply
      // anyway.
      for (const statement of componentBody.body ?? []) {
        if (!isNodeOfType(statement, "ExpressionStatement")) continue;
        const effectCall = unwrapDiscardedExpression(statement);
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if (!isReactHookCall(effectCall, EFFECT_HOOK_NAMES, context.scopes)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) continue;
        const depIdentifierNames = new Set<string>();
        for (const element of depsNode.elements ?? []) {
          if (isNodeOfType(element, "Identifier")) depIdentifierNames.add(element.name);
        }
        if (depIdentifierNames.size === 0) continue;

        const callback = getEffectCallback(effectCall);
        if (!callback) continue;
        const bodyStatements = getCallbackStatements(callback);
        if (bodyStatements.length !== 1) continue;
        const onlyStatement = bodyStatements[0];
        const expression = unwrapDiscardedExpression(onlyStatement);
        if (!isNodeOfType(expression, "CallExpression")) continue;
        if (!isNodeOfType(expression.callee, "Identifier")) continue;
        if (!isSetterIdentifier(expression.callee.name)) continue;
        if (!expression.arguments?.length) continue;
        const setterArgument = expression.arguments[0];

        const calleeName = expression.callee.name;
        const matchedBinding = mirrorBindings.find(
          (binding) =>
            binding.setterName === calleeName &&
            depIdentifierNames.has(binding.propRootName) &&
            hasOnlyMirrorDeps(depIdentifierNames, binding) &&
            areExpressionsStructurallyEqual(binding.initializer, setterArgument),
        );
        if (!matchedBinding) continue;
        // Initial-only / seed prop names (`initialCount`, `defaultX`,
        // `seedY`) are the documented "re-seed when the caller passes a
        // new initial value" idiom — the sibling rules
        // `no-derived-state-effect` and `no-derived-state` already
        // exempt this exact shape, so match them here.
        if (isInitialOnlyPropName(matchedBinding.propRootName)) continue;

        context.report({
          node: effectCall,
          message: `Your screen shows the old value first because useState "${matchedBinding.valueName}" copies prop "${matchedBinding.propRootName}" through this effect.`,
        });
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
});
