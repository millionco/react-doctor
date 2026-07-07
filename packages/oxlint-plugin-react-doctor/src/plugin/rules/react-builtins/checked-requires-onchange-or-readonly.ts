import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MISSING_MESSAGE = "Your users can't toggle this input because `checked` has no `onChange`.";
const EXCLUSIVE_MESSAGE =
  "This input mixes `checked` with `defaultChecked`, so React can't tell whether it is controlled or uncontrolled.";

interface CheckedRequiresSettings {
  ignoreMissingProperties?: boolean;
  ignoreExclusiveCheckedAttribute?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<CheckedRequiresSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { checkedRequiresOnchangeOrReadonly?: CheckedRequiresSettings })
          .checkedRequiresOnchangeOrReadonly ?? {})
      : {};
  return {
    ignoreMissingProperties: ruleSettings.ignoreMissingProperties ?? false,
    ignoreExclusiveCheckedAttribute: ruleSettings.ignoreExclusiveCheckedAttribute ?? false,
  };
};

interface AttributePresence {
  checkedNode: EsTreeNode | null;
  defaultCheckedNode: EsTreeNode | null;
  bothCheckedAndDefaultForwarded: boolean;
  hasOnChangeOrReadOnly: boolean;
  hasSpread: boolean;
  hasTruthyDisabled: boolean;
}

// `checked={checked} defaultChecked={defaultChecked}` where BOTH values are
// plain variable/member reads is the standard design-system forwarding
// pattern: consumers supply exactly one, the other is `undefined` at runtime
// (which React treats as absent), so no controlled/uncontrolled ambiguity
// materializes. A literal on either side (`checked`, `checked={true}`) means
// the author really hard-wired both modes and still fires.
const isForwardedValueExpression = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "Identifier") ||
  (isNodeOfType(expression, "MemberExpression") && !expression.computed);

const jsxAttributeForwardsValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  return isForwardedValueExpression(attribute.value.expression as EsTreeNode);
};

const isTruthyDisabledJsxValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    const expression = attribute.value.expression as EsTreeNode;
    return isNodeOfType(expression, "Literal") && expression.value === true;
  }
  return false;
};

const collectFromJsxAttributes = (attributes: ReadonlyArray<EsTreeNode>): AttributePresence => {
  let checkedNode: EsTreeNode | null = null;
  let checkedForwarded = false;
  let defaultCheckedNode: EsTreeNode | null = null;
  let defaultCheckedForwarded = false;
  let hasOnChangeOrReadOnly = false;
  let hasSpread = false;
  let hasTruthyDisabled = false;
  for (const attribute of attributes) {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      hasSpread = true;
      continue;
    }
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const name = getJsxAttributeName(attribute.name);
    if (name === "checked") {
      checkedNode = attribute;
      checkedForwarded = jsxAttributeForwardsValue(attribute);
    } else if (name === "defaultChecked" && !defaultCheckedNode) {
      defaultCheckedNode = attribute;
      defaultCheckedForwarded = jsxAttributeForwardsValue(attribute);
    } else if (name === "onChange" || name === "readOnly") hasOnChangeOrReadOnly = true;
    else if (name === "disabled" && isTruthyDisabledJsxValue(attribute)) hasTruthyDisabled = true;
  }
  return {
    checkedNode,
    defaultCheckedNode,
    bothCheckedAndDefaultForwarded: checkedForwarded && defaultCheckedForwarded,
    hasOnChangeOrReadOnly,
    hasSpread,
    hasTruthyDisabled,
  };
};

const collectFromObjectProperties = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): AttributePresence => {
  let checkedNode: EsTreeNode | null = null;
  let checkedForwarded = false;
  let defaultCheckedNode: EsTreeNode | null = null;
  let defaultCheckedForwarded = false;
  let hasOnChangeOrReadOnly = false;
  let hasSpread = false;
  let hasTruthyDisabled = false;
  for (const property of objectExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      hasSpread = true;
      continue;
    }
    if (!isNodeOfType(property, "Property")) continue;
    const key = property.key;
    let propertyName: string | null = null;
    if (isNodeOfType(key, "Identifier")) propertyName = key.name;
    else if (isNodeOfType(key, "Literal") && typeof key.value === "string")
      propertyName = key.value;
    if (!propertyName) continue;
    if (propertyName === "checked") {
      checkedNode = property;
      checkedForwarded = isForwardedValueExpression(property.value as EsTreeNode);
    } else if (propertyName === "defaultChecked" && !defaultCheckedNode) {
      defaultCheckedNode = property;
      defaultCheckedForwarded = isForwardedValueExpression(property.value as EsTreeNode);
    } else if (propertyName === "onChange" || propertyName === "readOnly")
      hasOnChangeOrReadOnly = true;
    else if (propertyName === "disabled") {
      const propertyValue = property.value as EsTreeNode;
      if (isNodeOfType(propertyValue, "Literal") && propertyValue.value === true)
        hasTruthyDisabled = true;
    }
  }
  return {
    checkedNode,
    defaultCheckedNode,
    bothCheckedAndDefaultForwarded: checkedForwarded && defaultCheckedForwarded,
    hasOnChangeOrReadOnly,
    hasSpread,
    hasTruthyDisabled,
  };
};

// Port of `oxc_linter::rules::react::checked_requires_onchange_or_readonly`.
// Reports `<input type="checkbox" checked>` (and createElement equivalent)
// without `onChange` or `readOnly`, and reports `checked + defaultChecked`
// used together. Settings let either check be silenced.
export const checkedRequiresOnchangeOrReadonly = defineRule({
  id: "checked-requires-onchange-or-readonly",
  title: "Checked input without onChange",
  severity: "warn",
  recommendation:
    "Add `onChange`, `readOnly`, or `defaultChecked` so React knows whether the checkbox is editable, display-only, or uncontrolled.",
  category: "Correctness",
  create: (context) => {
    const settings = resolveSettings(context.settings);

    const reportFromPresence = (presence: AttributePresence): void => {
      if (
        presence.checkedNode &&
        presence.defaultCheckedNode &&
        !presence.bothCheckedAndDefaultForwarded &&
        !settings.ignoreExclusiveCheckedAttribute
      ) {
        context.report({ node: presence.checkedNode, message: EXCLUSIVE_MESSAGE });
      }
      if (
        presence.checkedNode &&
        !presence.hasOnChangeOrReadOnly &&
        !presence.hasSpread &&
        !presence.hasTruthyDisabled &&
        !settings.ignoreMissingProperties
      ) {
        // A spread (`{...rest}`) can supply `onChange`/`readOnly` at
        // runtime, so their absence in the explicit attributes isn't
        // proof, and React's own controlled-checkbox warning exempts
        // `disabled` inputs (users can't toggle them anyway).
        context.report({ node: presence.checkedNode, message: MISSING_MESSAGE });
      }
    };

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "input") return;
        reportFromPresence(collectFromJsxAttributes(node.attributes));
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isCreateElementCall(node)) return;
        const firstArgument = node.arguments[0];
        if (!firstArgument) return;
        if (!isNodeOfType(firstArgument, "Literal") || firstArgument.value !== "input") return;
        const propsArgument = node.arguments[1];
        if (!propsArgument || !isNodeOfType(propsArgument, "ObjectExpression")) return;
        reportFromPresence(collectFromObjectProperties(propsArgument));
      },
    };
  },
});
