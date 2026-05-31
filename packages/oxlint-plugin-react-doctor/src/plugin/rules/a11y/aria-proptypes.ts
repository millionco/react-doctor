import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Each ARIA prop's value type, mirroring OXC's `AriaPropType` enum.
type AriaPropType =
  | { kind: "boolean" }
  | { kind: "optional-boolean" }
  | { kind: "tristate" }
  | { kind: "string" }
  | { kind: "id" }
  | { kind: "id-list" }
  | { kind: "integer" }
  | { kind: "number" }
  | { kind: "token"; tokens: ReadonlyArray<string> }
  | { kind: "token-list"; tokens: ReadonlyArray<string> };

const ARIA_PROP_TYPES: Record<string, AriaPropType> = {
  "aria-activedescendant": { kind: "id" },
  "aria-details": { kind: "id" },
  "aria-errormessage": { kind: "id" },
  "aria-atomic": { kind: "boolean" },
  "aria-busy": { kind: "boolean" },
  "aria-disabled": { kind: "boolean" },
  "aria-modal": { kind: "boolean" },
  "aria-multiline": { kind: "boolean" },
  "aria-multiselectable": { kind: "boolean" },
  "aria-readonly": { kind: "boolean" },
  "aria-required": { kind: "boolean" },
  "aria-braillelabel": { kind: "string" },
  "aria-brailleroledescription": { kind: "string" },
  "aria-description": { kind: "string" },
  "aria-keyshortcuts": { kind: "string" },
  "aria-label": { kind: "string" },
  "aria-placeholder": { kind: "string" },
  "aria-roledescription": { kind: "string" },
  "aria-valuetext": { kind: "string" },
  "aria-checked": { kind: "tristate" },
  "aria-pressed": { kind: "tristate" },
  "aria-colcount": { kind: "integer" },
  "aria-colindex": { kind: "integer" },
  "aria-colspan": { kind: "integer" },
  "aria-level": { kind: "integer" },
  "aria-posinset": { kind: "integer" },
  "aria-rowcount": { kind: "integer" },
  "aria-rowindex": { kind: "integer" },
  "aria-rowspan": { kind: "integer" },
  "aria-setsize": { kind: "integer" },
  "aria-controls": { kind: "id-list" },
  "aria-describedby": { kind: "id-list" },
  "aria-flowto": { kind: "id-list" },
  "aria-labelledby": { kind: "id-list" },
  "aria-owns": { kind: "id-list" },
  "aria-expanded": { kind: "optional-boolean" },
  "aria-grabbed": { kind: "optional-boolean" },
  "aria-hidden": { kind: "optional-boolean" },
  "aria-selected": { kind: "optional-boolean" },
  "aria-valuemax": { kind: "number" },
  "aria-valuemin": { kind: "number" },
  "aria-valuenow": { kind: "number" },
  "aria-autocomplete": {
    kind: "token",
    tokens: ["none", "inline", "list", "both"],
  },
  "aria-current": {
    kind: "token",
    tokens: ["page", "step", "location", "date", "time", "true", "false"],
  },
  "aria-haspopup": {
    kind: "token",
    tokens: ["false", "true", "menu", "listbox", "tree", "grid", "dialog"],
  },
  "aria-invalid": {
    kind: "token",
    tokens: ["grammar", "false", "spelling", "true"],
  },
  "aria-live": { kind: "token", tokens: ["assertive", "off", "polite"] },
  "aria-orientation": {
    kind: "token",
    tokens: ["horizontal", "undefined", "vertical"],
  },
  "aria-sort": {
    kind: "token",
    tokens: ["ascending", "descending", "none", "other"],
  },
  "aria-dropeffect": {
    kind: "token-list",
    tokens: ["copy", "execute", "link", "move", "none", "popup"],
  },
  "aria-relevant": {
    kind: "token-list",
    tokens: ["additions", "all", "removals", "text"],
  },
};

const buildExpectedDescription = (propType: AriaPropType): string => {
  switch (propType.kind) {
    case "boolean":
    case "optional-boolean":
      return "'true' or 'false'";
    case "tristate":
      return "'true', 'false', or 'mixed'";
    case "string":
      return "a string value";
    case "integer":
      return "an integer value";
    case "number":
      return "a number value";
    case "id":
      return "a single element ID";
    case "id-list":
      return "a space-separated list of element IDs";
    case "token":
      return `one of: ${propType.tokens.join(", ")}`;
    case "token-list":
      return `a space-separated list of: ${propType.tokens.join(", ")}`;
  }
};

const buildMessage = (propName: string, propType: AriaPropType): string =>
  `Screen reader users get no help from \`${propName}\` because its value isn't readable, so set it to ${buildExpectedDescription(propType)}.`;

// Returns true when the bare attribute (no value) is allowed for this
// type (e.g. `<div aria-hidden />`).
const allowNoneValue = (propType: AriaPropType): boolean => {
  switch (propType.kind) {
    case "boolean":
    case "optional-boolean":
    case "tristate":
    case "string":
      return true;
    case "token":
    case "token-list":
      return propType.tokens.includes("true");
    default:
      return false;
  }
};

// Statically evaluate an expression to a boolean per OXC's
// `to_boolean(WithoutGlobalReferenceInformation)`. Returns null if
// unevaluable.
const expressionToBoolean = (expression: EsTreeNode): boolean | null => {
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "boolean") return expression.value;
    if (typeof expression.value === "string") return expression.value.length > 0;
    if (typeof expression.value === "number")
      return expression.value !== 0 && !Number.isNaN(expression.value);
    if (expression.value === null) return false;
    return null;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    return staticValue === null ? null : staticValue.length > 0;
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const inner = expressionToBoolean(expression.argument as EsTreeNode);
    return inner === null ? null : !inner;
  }
  return null;
};

// True iff the value is a "target literal" — the only kind we
// statically validate. Other shapes (identifiers, member expressions,
// JSX, conditional expressions, …) pass through.
const isTargetLiteralValue = (value: EsTreeNode): boolean => {
  if (isNodeOfType(value, "Literal")) return true;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      // null literals always pass per OXC.
      return expression.value !== null;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) return true;
    if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
      return expressionToBoolean(expression.argument as EsTreeNode) !== null;
    }
    return false;
  }
  return false;
};

// Convert a literal value into a normalized lowercase string.
// `booleanAsString=true` → `true`/`false` literals stringify; in
// non-string mode (numeric / IDList) booleans yield null.
const parseAriaValueAsString = (value: EsTreeNode, booleanAsString: boolean): string | null => {
  if (isNodeOfType(value, "Literal")) {
    if (typeof value.value === "string") return value.value.toLowerCase();
    return null;
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "string") return expression.value.toLowerCase();
      if (typeof expression.value === "boolean") {
        return booleanAsString ? String(expression.value) : null;
      }
      return null;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      return getStaticTemplateLiteralValue(expression)?.toLowerCase() ?? null;
    }
    if (
      booleanAsString &&
      isNodeOfType(expression, "UnaryExpression") &&
      expression.operator === "!"
    ) {
      const inner = expressionToBoolean(expression.argument as EsTreeNode);
      if (inner === null) return null;
      return String(!inner);
    }
  }
  return null;
};

// Returns true iff value is a multi-quasi template literal (template
// with at least one `${expr}` interpolation).
const isMultiQuasiTemplate = (value: EsTreeNode): boolean => {
  if (!isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = value.expression;
  if (!isNodeOfType(expression, "TemplateLiteral")) return false;
  return (expression.expressions ?? []).length > 0;
};

const isValidValueForType = (propType: AriaPropType, value: EsTreeNode): boolean => {
  if (!isTargetLiteralValue(value)) return true;
  switch (propType.kind) {
    case "boolean":
    case "optional-boolean": {
      const stringValue = parseAriaValueAsString(value, true);
      return stringValue === "true" || stringValue === "false";
    }
    case "tristate": {
      const stringValue = parseAriaValueAsString(value, true);
      return stringValue === "true" || stringValue === "false" || stringValue === "mixed";
    }
    case "string":
    case "id": {
      // Templates with interpolation always produce a string at runtime.
      if (isMultiQuasiTemplate(value)) return true;
      return parseAriaValueAsString(value, false) !== null;
    }
    case "integer":
    case "number": {
      const stringValue = parseAriaValueAsString(value, false);
      if (stringValue !== null) {
        const parsed = Number(stringValue);
        return Number.isFinite(parsed);
      }
      // Non-string literal: only numeric expression containers pass.
      if (isNodeOfType(value, "JSXExpressionContainer")) {
        const expression = value.expression;
        if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
          return true;
        }
        // OXC also accepts +/- / ~ unary operators applied to numeric literals.
        if (
          isNodeOfType(expression, "UnaryExpression") &&
          (expression.operator === "-" ||
            expression.operator === "+" ||
            expression.operator === "~") &&
          isNodeOfType(expression.argument, "Literal") &&
          typeof expression.argument.value === "number"
        ) {
          return true;
        }
      }
      return false;
    }
    case "id-list": {
      // Templates with interpolation always produce a string at runtime.
      if (isMultiQuasiTemplate(value)) return true;
      const stringValue = parseAriaValueAsString(value, false);
      if (stringValue === null) return false;
      // At least one non-whitespace token.
      return stringValue.trim().length > 0;
    }
    case "token": {
      const stringValue = parseAriaValueAsString(value, true);
      return stringValue !== null && propType.tokens.includes(stringValue);
    }
    case "token-list": {
      const stringValue = parseAriaValueAsString(value, true);
      if (stringValue === null) return false;
      const tokens = stringValue.split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length === 0) return false;
      return tokens.every((token) => propType.tokens.includes(token));
    }
  }
};

// Port of `oxc_linter::rules::jsx_a11y::aria_proptypes`.
export const ariaProptypes = defineRule<Rule>({
  id: "aria-proptypes",
  title: "Invalid ARIA attribute value",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Give each `aria-*` attribute the kind of value it expects.",
  category: "Accessibility",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name as EsTreeNode, "JSXIdentifier")) return;
      const rawName = getJsxAttributeName(node.name as EsTreeNodeOfType<"JSXIdentifier">);
      if (!rawName) return;
      const propName = rawName.toLowerCase();
      const propType = ARIA_PROP_TYPES[propName];
      if (!propType) return;
      if (!node.value) {
        if (!allowNoneValue(propType)) {
          context.report({ node, message: buildMessage(propName, propType) });
        }
        return;
      }
      if (!isValidValueForType(propType, node.value as EsTreeNode)) {
        context.report({ node, message: buildMessage(propName, propType) });
      }
    },
  }),
});
