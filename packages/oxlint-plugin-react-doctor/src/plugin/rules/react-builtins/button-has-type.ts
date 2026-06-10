import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";

const MISSING_MESSAGE =
  "Your users can submit the form by accident because a `<button>` with no `type` defaults to submit.";
const INVALID_MESSAGE =
  "This button has an invalid `type`, so the browser may treat it like a submit button.";

interface ButtonHasTypeSettings {
  button?: boolean;
  submit?: boolean;
  reset?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ButtonHasTypeSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { buttonHasType?: ButtonHasTypeSettings }).buttonHasType ?? {})
      : {};
  return {
    button: ruleSettings.button ?? true,
    submit: ruleSettings.submit ?? true,
    reset: ruleSettings.reset ?? true,
  };
};

const isValidTypeValue = (rawValue: string, settings: Required<ButtonHasTypeSettings>): boolean => {
  if (rawValue === "button") return settings.button;
  if (rawValue === "submit") return settings.submit;
  if (rawValue === "reset") return settings.reset;
  return false;
};

// Returns true when the expression can be statically proven to always
// produce one of the allowed type values (so the rule should NOT fire).
// Anything that can't be proven valid — identifiers, dynamic template
// literals, mixed-branch conditionals — falls through to `false` which
// fires the diagnostic. This matches OXC's "if you can't show me a
// valid value, it's invalid" stance.
const isProvenValidExpression = (
  expression: EsTreeNode,
  settings: Required<ButtonHasTypeSettings>,
): boolean => {
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return isValidTypeValue(expression.value, settings);
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    if (staticValue !== null) return isValidTypeValue(staticValue, settings);
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      isProvenValidExpression(expression.consequent, settings) &&
      isProvenValidExpression(expression.alternate, settings)
    );
  }
  return false;
};

// `<button type={type}>` (or `<button type={props.type}>`) is a
// wrapper component forwarding the consumer's chosen type — the rule
// should fire at the CONSUMER's call site (where the literal value
// lives), not at the trampoline. Without this every styled-button
// wrapper that exposes `type` to its caller eats a diagnostic.
const isConsumerPropForward = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier") && expression.name === "type") {
    return true;
  }
  if (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === "type"
  ) {
    return true;
  }
  // `type={type ?? 'button'}` / `type={type || 'submit'}` — defaulted
  // forward where the fallback is itself valid.
  if (
    isNodeOfType(expression, "LogicalExpression") &&
    (expression.operator === "??" || expression.operator === "||")
  ) {
    return isConsumerPropForward(expression.left as EsTreeNode);
  }
  return false;
};

const reportInvalid = (context: Parameters<Rule["create"]>[0], reportNode: EsTreeNode): void => {
  context.report({ node: reportNode, message: INVALID_MESSAGE });
};

// Port of `oxc_linter::rules::react::button_has_type`. Flags
//   - `<button>` without a `type` attribute,
//   - `<button type="foo">` outside the allowed set,
//   - `React.createElement("button", { type: "foo" })` equivalents.
// Three settings (button/submit/reset, default true) toggle which
// values are allowed.
export const buttonHasType = defineRule<Rule>({
  id: "button-has-type",
  title: "Button missing explicit type",
  severity: "warn",
  recommendation:
    'Set an explicit button `type` so plain buttons do not submit forms by accident: `type="button"`, `"submit"`, or `"reset"`.',
  create: (context) => {
    const settings = resolveSettings(context.settings);
    // Storybook stories and tests routinely render bare `<button>` without
    // a `type` attribute — the buttons aren't inside a real form so the
    // implicit `submit` behaviour is irrelevant. Skip these.
    const isTestlikeFile = isTestlikeFilename(context.filename);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "button") return;
        const typeAttr = hasJsxPropIgnoreCase(node.attributes, "type");
        if (!typeAttr) {
          context.report({ node: node.name, message: MISSING_MESSAGE });
          return;
        }
        const value = typeAttr.value;
        // Bare `<button type />` is shorthand for `type={true}` — not
        // any of the allowed string values.
        if (!value) {
          reportInvalid(context, typeAttr);
          return;
        }
        if (isNodeOfType(value, "Literal")) {
          if (!isProvenValidExpression(value, settings)) reportInvalid(context, typeAttr);
          return;
        }
        if (isNodeOfType(value, "JSXExpressionContainer")) {
          const expression = value.expression;
          if (!expression || expression.type === "JSXEmptyExpression") return;
          if (isConsumerPropForward(expression as EsTreeNode)) return;
          if (!isProvenValidExpression(expression as EsTreeNode, settings)) {
            reportInvalid(context, typeAttr);
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isTestlikeFile) return;
        if (!isCreateElementCall(node)) return;
        const firstArgument = node.arguments[0];
        if (
          !firstArgument ||
          !isNodeOfType(firstArgument, "Literal") ||
          firstArgument.value !== "button"
        ) {
          return;
        }
        const propsArgument = node.arguments[1];
        if (!propsArgument || !isNodeOfType(propsArgument, "ObjectExpression")) {
          context.report({ node, message: MISSING_MESSAGE });
          return;
        }
        let typeProp: EsTreeNode | null = null;
        for (const property of propsArgument.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          const propertyKey = property.key;
          const matches =
            (isNodeOfType(propertyKey, "Identifier") && propertyKey.name === "type") ||
            (isNodeOfType(propertyKey, "Literal") && propertyKey.value === "type");
          if (matches) {
            typeProp = property.value;
            break;
          }
        }
        if (!typeProp) {
          context.report({ node: propsArgument, message: MISSING_MESSAGE });
          return;
        }
        // Mirror the JSX branch: consumer-forwarded `type` (`{ type: type }`
        // / `{ type: props.type }` / defaulted forwards) is a wrapper
        // re-exporting the prop, so the diagnostic should fire at the
        // caller's literal, not at the trampoline.
        if (isConsumerPropForward(typeProp)) return;
        if (!isProvenValidExpression(typeProp, settings)) {
          reportInvalid(context, typeProp);
        }
      },
    };
  },
});
