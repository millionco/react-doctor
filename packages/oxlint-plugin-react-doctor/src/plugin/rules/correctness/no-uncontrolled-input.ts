import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropExhaustiveStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const UNCONTROLLED_INPUT_TAGS = new Set(["input", "textarea", "select"]);

// HACK: React does not require an onChange handler for `value` on these input
// types. Its value/defaultValue and controlledness warnings are separate.
const VALUE_BYPASS_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "hidden",
  "image",
  "radio",
  "reset",
  "submit",
]);

// `onInput` fires on every value change in React's DOM model exactly
// like `onChange`, so a `value`-bound input wired to `onInput` is just
// as controlled (the SolidJS-port idiom keeps `onInput`). `disabled`
// (like `readOnly`) suppresses React's own missing-`onChange` warning —
// the user can't type into a disabled/read-only field, so a static
// `value` needs no handler and must not be flagged. The one statically
// decidable exception: a literal `disabled={false}` is never disabled,
// so it doesn't excuse the missing handler (dynamic `disabled={expr}`
// stays exempt — we can't prove it's ever enabled).
const VALUE_PARTNER_ATTRIBUTES = ["onChange", "onInput", "readOnly", "disabled"];

const isLiteralFalseAttributeValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean =>
  isNodeOfType(attribute.value, "JSXExpressionContainer") &&
  isNodeOfType(attribute.value.expression, "Literal") &&
  attribute.value.expression.value === false;

const isUseStateUndefinedInitializer = (init: EsTreeNode | null | undefined): boolean => {
  if (!init || !isNodeOfType(init, "CallExpression")) return false;
  if (!isHookCall(init, "useState")) return false;
  const args = init.arguments ?? [];
  if (args.length === 0) return true;
  const firstArgument = args[0];
  return isNodeOfType(firstArgument, "Identifier") && firstArgument.name === "undefined";
};

const collectUndefinedInitialStateNames = (componentBody: EsTreeNode): Set<string> => {
  const stateNames = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return stateNames;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
      const valueElement = declarator.id.elements?.[0];
      if (!isNodeOfType(valueElement, "Identifier")) continue;
      if (!isUseStateUndefinedInitializer(declarator.init)) continue;
      stateNames.add(valueElement.name);
    }
  }
  return stateNames;
};

const hasJsxSpreadAttribute = (attributes: EsTreeNode[]): boolean =>
  attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"));

// HACK: catches three uncontrolled-input mistakes that React's static
// rule set misses:
//   1. `value={...}` without `onChange` / `readOnly` — React renders
//      this as a silently read-only field at runtime.
//   2. `value` AND `defaultValue` set together — React ignores
//      defaultValue on a controlled input.
//   3. `value={state}` where `state` was initialized as undefined
//      (e.g. `useState()` with no argument) — the input starts
//      uncontrolled and flips to controlled on first set, which React
//      logs a runtime warning for.
//
// Bails when a spread attribute (`{...rest}`) is present — react-hook-form's
// `register()`, Headless UI, Radix, etc. routinely supply `onChange` /
// `defaultValue` via spread, and we can't see through it without scope
// analysis. False-negative > false-positive on a heavily used pattern.
//
// Tagged `test-noise` so `defineRule` skips test-like files entirely:
// jest/vitest suites routinely render deliberately static
// `<input value={x} />` presentational stubs, where the missing handler
// is intentional, never user-facing (ant-design's form __tests__ was a
// mined FP).
export const noUncontrolledInput = defineRule({
  id: "no-uncontrolled-input",
  title: "Uncontrolled input value",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    'Give `useState` a starting value (e.g. `useState("")` instead of `useState()`), add `onChange` (or `readOnly`) whenever you set `value`, and drop `defaultValue` on controlled inputs since React ignores it.',
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody) return;
      // Concise arrow bodies (`() => <input ... />`) skip the BlockStatement
      // wrapper; walk the JSX expression directly. There are no useState
      // declarations to collect for the undefined-initializer check, so an
      // empty set is correct.
      const undefinedInitialStateNames = isNodeOfType(componentBody, "BlockStatement")
        ? collectUndefinedInitialStateNames(componentBody)
        : new Set<string>();

      walkAst(componentBody, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "JSXOpeningElement")) return;
        const tagName = resolveJsxElementType(child);
        if (!UNCONTROLLED_INPUT_TAGS.has(tagName)) return;

        const attributes = child.attributes ?? [];
        if (hasJsxSpreadAttribute(attributes)) return;

        const valueAttribute = findJsxAttribute(attributes, "value");
        if (!valueAttribute) return;

        let inputTypeCandidates: ReadonlyArray<string> | null = null;
        let hasExplicitInputType = false;
        let doesTypeBypassMissingOnChange = false;
        let doesTypeUseCheckedControlledness = false;
        let couldTypeUseCheckedControlledness = false;
        if (tagName === "input") {
          const typeAttribute = findJsxAttribute([...attributes].reverse(), "type");
          hasExplicitInputType = Boolean(typeAttribute);
          inputTypeCandidates = typeAttribute
            ? getJsxPropExhaustiveStaticStringValues(typeAttribute, context.scopes)
            : null;
          doesTypeBypassMissingOnChange = Boolean(
            inputTypeCandidates !== null &&
            inputTypeCandidates.length > 0 &&
            inputTypeCandidates.every((inputTypeCandidate) =>
              VALUE_BYPASS_INPUT_TYPES.has(inputTypeCandidate.toLowerCase()),
            ),
          );
          doesTypeUseCheckedControlledness = Boolean(
            inputTypeCandidates !== null &&
            inputTypeCandidates.length > 0 &&
            inputTypeCandidates.every(
              (inputTypeCandidate) =>
                inputTypeCandidate === "checkbox" || inputTypeCandidate === "radio",
            ),
          );
          couldTypeUseCheckedControlledness = Boolean(
            hasExplicitInputType &&
            (inputTypeCandidates === null ||
              inputTypeCandidates.some(
                (inputTypeCandidate) =>
                  inputTypeCandidate === "checkbox" || inputTypeCandidate === "radio",
              )),
          );
        }

        const hasAllowedPartner = VALUE_PARTNER_ATTRIBUTES.some((partnerAttributeName) => {
          const partnerAttribute = findJsxAttribute(attributes, partnerAttributeName);
          if (!partnerAttribute) return false;
          if (partnerAttributeName === "disabled" && isLiteralFalseAttributeValue(partnerAttribute))
            return false;
          return true;
        });

        if (
          isNodeOfType(valueAttribute.value, "JSXExpressionContainer") &&
          isNodeOfType(valueAttribute.value.expression, "Identifier") &&
          undefinedInitialStateNames.has(valueAttribute.value.expression.name) &&
          !doesTypeUseCheckedControlledness
        ) {
          const stateName = valueAttribute.value.expression.name;
          const partnerHint =
            hasAllowedPartner || doesTypeBypassMissingOnChange || couldTypeUseCheckedControlledness
              ? "Give useState a starting value"
              : "Give useState a starting value and add onChange (or readOnly)";
          context.report({
            node: child,
            message: couldTypeUseCheckedControlledness
              ? `When \`type\` resolves to a value-controlled input type, this can trigger a console warning and reset the field because "${stateName}" starts undefined, so <input value={${stateName}}> can flip from uncontrolled to controlled. ${partnerHint} (e.g. \`useState("")\`).`
              : `This can trigger a console warning and reset the field because "${stateName}" starts undefined, so <${tagName} value={${stateName}}> flips from uncontrolled to controlled. ${partnerHint} (e.g. \`useState("")\`).`,
          });
          return;
        }

        if (findJsxAttribute(attributes, "defaultValue")) {
          context.report({
            node: child,
            message: `Your users never see the \`defaultValue\` on this <${tagName}> because React ignores it once \`value\` is set, so remove one.`,
          });
          return;
        }

        if (!hasAllowedPartner && !doesTypeBypassMissingOnChange) {
          const couldResolveToReadOnlyValueType =
            tagName === "input" &&
            hasExplicitInputType &&
            (inputTypeCandidates === null ||
              inputTypeCandidates.some((inputTypeCandidate) =>
                VALUE_BYPASS_INPUT_TYPES.has(inputTypeCandidate.toLowerCase()),
              ));
          context.report({
            node: child,
            message: couldResolveToReadOnlyValueType
              ? `When \`type\` resolves to an editable input type, users can't type in this <input value={...}> because it has no \`onChange\` or \`readOnly\`. Add \`onChange\` or \`readOnly\` unless \`type\` is always a read-only-value input type.`
              : `Your users can't type in this <${tagName} value={...}> because it has no \`onChange\` or \`readOnly\`, so add \`onChange\` (or \`readOnly\` if that's intended).`,
          });
        }
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isInlineFunctionExpression(node.init)) return;
        checkComponent(node.init.body);
      },
    };
  },
});
