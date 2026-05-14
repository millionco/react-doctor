import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
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
  const rootName = getRootIdentifierName(expression, { followCallChains: true });
  return rootName !== null && propNames.has(rootName) ? rootName : null;
};

interface MirrorBinding {
  valueName: string;
  setterName: string;
  initializer: EsTreeNode;
  propRootName: string;
}

export const noMirrorPropEffect = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Delete both the `useState` and the `useEffect` and read the prop directly during render. Mirroring a prop into local state forces a stale first render before the effect re-syncs",
  examples: [
    {
      before:
        "function Profile({ user }) {\n  const [name, setName] = useState(user.name);\n  useEffect(() => { setName(user.name); }, [user.name]);\n  return <span>{name}</span>;\n}",
      after: "function Profile({ user }) { return <span>{user.name}</span>; }",
    },
  ],
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
          if (!isHookCall(declarator.init, "useState")) continue;
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
        const effectCall = statement.expression;
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) continue;
        // HACK: previously required EXACTLY one dep, which silently
        // missed the legitimate `useEffect(() => setX(value), [value, otherDep])`
        // mirror shape. Now we accept any deps array as long as the
        // prop root we mirror IS one of the deps — `otherDep` being
        // unused inside the body is a separate (exhaustive-deps) concern.
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
        const expression = isNodeOfType(onlyStatement, "ExpressionStatement")
          ? onlyStatement.expression
          : onlyStatement;
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
            areExpressionsStructurallyEqual(binding.initializer, setterArgument),
        );
        if (!matchedBinding) continue;

        context.report({
          node: effectCall,
          message: `useState "${matchedBinding.valueName}" is mirrored from prop "${matchedBinding.propRootName}" via this effect — delete both the useState and the effect, and read the prop directly in render`,
        });
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
});
