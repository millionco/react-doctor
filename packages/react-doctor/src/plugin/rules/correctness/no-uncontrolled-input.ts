import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const UNCONTROLLED_INPUT_TAGS = new Set(["input", "textarea", "select"]);

// HACK: <input type="checkbox"> / "radio" use the `checked` prop to be
// controlled; `value` is just the form-submission token. <input
// type="hidden"> never needs onChange — React's runtime warning skips
// it for the same reason. Limiting our `value`-needs-onChange check to
// non-hidden, non-checkable inputs keeps us aligned with React's own
// rules.
const VALUE_BYPASS_INPUT_TYPES = new Set(["hidden", "checkbox", "radio"]);

const VALUE_PARTNER_ATTRIBUTES = ["onChange", "readOnly"];

const getInputTypeLiteral = (attributes: EsTreeNode[]): string | null => {
  const typeAttribute = findJsxAttribute(attributes, "type");
  if (!typeAttribute || !isNodeOfType(typeAttribute.value, "Literal")) return null;
  const value = typeAttribute.value.value;
  return typeof value === "string" ? value : null;
};

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
export const noUncontrolledInput = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Correctness",
  recommendation:
    'Pass an explicit initial value to `useState` (e.g. `useState("")` instead of `useState()`), add `onChange` (or `readOnly` to opt out) when you supply `value`, and drop `defaultValue` on controlled inputs — React ignores it',
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
        if (!isNodeOfType(child.name, "JSXIdentifier")) return;
        const tagName = child.name.name;
        if (!UNCONTROLLED_INPUT_TAGS.has(tagName)) return;

        const attributes = child.attributes ?? [];
        if (hasJsxSpreadAttribute(attributes)) return;

        const valueAttribute = findJsxAttribute(attributes, "value");
        if (!valueAttribute) return;

        if (tagName === "input") {
          const inputType = getInputTypeLiteral(attributes);
          if (inputType !== null && VALUE_BYPASS_INPUT_TYPES.has(inputType)) return;
        }

        const hasAllowedPartner = VALUE_PARTNER_ATTRIBUTES.some((partnerAttributeName) =>
          findJsxAttribute(attributes, partnerAttributeName),
        );

        if (
          isNodeOfType(valueAttribute.value, "JSXExpressionContainer") &&
          isNodeOfType(valueAttribute.value.expression, "Identifier") &&
          undefinedInitialStateNames.has(valueAttribute.value.expression.name)
        ) {
          const stateName = valueAttribute.value.expression.name;
          const partnerHint = hasAllowedPartner
            ? "Initialize useState with an explicit value"
            : "Initialize useState with an explicit value AND add onChange (or readOnly)";
          context.report({
            node: child,
            message: `<${tagName} value={${stateName}}> — "${stateName}" is initialized as undefined (uncontrolled), then becomes controlled on first set; React warns about this flip. ${partnerHint} (e.g. \`useState("")\`)`,
          });
          return;
        }

        if (findJsxAttribute(attributes, "defaultValue")) {
          context.report({
            node: child,
            message: `<${tagName}> sets both \`value\` and \`defaultValue\` — defaultValue is ignored on a controlled input; remove one`,
          });
          return;
        }

        if (!hasAllowedPartner) {
          context.report({
            node: child,
            message: `<${tagName} value={...}> with no \`onChange\` or \`readOnly\` — React renders this as a silently read-only field`,
          });
        }
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
});
