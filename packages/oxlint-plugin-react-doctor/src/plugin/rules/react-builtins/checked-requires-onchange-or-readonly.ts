import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MISSING_MESSAGE = "Your users can't toggle this input because `checked` has no `onChange`.";
const EXCLUSIVE_MESSAGE =
  "This input behaves unpredictably with both `checked` & `defaultChecked` set.";

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
  hasOnChangeOrReadOnly: boolean;
}

const collectFromJsxAttributes = (attributes: ReadonlyArray<EsTreeNode>): AttributePresence => {
  let checkedNode: EsTreeNode | null = null;
  let defaultCheckedNode: EsTreeNode | null = null;
  let hasOnChangeOrReadOnly = false;
  for (const attribute of attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const name = getJsxAttributeName(attribute.name);
    if (name === "checked") checkedNode = attribute;
    else if (name === "defaultChecked" && !defaultCheckedNode) defaultCheckedNode = attribute;
    else if (name === "onChange" || name === "readOnly") hasOnChangeOrReadOnly = true;
  }
  return { checkedNode, defaultCheckedNode, hasOnChangeOrReadOnly };
};

const collectFromObjectProperties = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): AttributePresence => {
  let checkedNode: EsTreeNode | null = null;
  let defaultCheckedNode: EsTreeNode | null = null;
  let hasOnChangeOrReadOnly = false;
  for (const property of objectExpression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const key = property.key;
    let propertyName: string | null = null;
    if (isNodeOfType(key, "Identifier")) propertyName = key.name;
    else if (isNodeOfType(key, "Literal") && typeof key.value === "string")
      propertyName = key.value;
    if (!propertyName) continue;
    if (propertyName === "checked") checkedNode = property;
    else if (propertyName === "defaultChecked" && !defaultCheckedNode)
      defaultCheckedNode = property;
    else if (propertyName === "onChange" || propertyName === "readOnly")
      hasOnChangeOrReadOnly = true;
  }
  return { checkedNode, defaultCheckedNode, hasOnChangeOrReadOnly };
};

// Port of `oxc_linter::rules::react::checked_requires_onchange_or_readonly`.
// Reports `<input type="checkbox" checked>` (and createElement equivalent)
// without `onChange` or `readOnly`, and reports `checked + defaultChecked`
// used together. Settings let either check be silenced.
export const checkedRequiresOnchangeOrReadonly = defineRule<Rule>({
  id: "checked-requires-onchange-or-readonly",
  title: "Checked input without onChange",
  severity: "warn",
  recommendation:
    "Add `onChange` (controlled) or `readOnly` (display-only), or use `defaultChecked` for an uncontrolled checkbox.",
  category: "Correctness",
  create: (context) => {
    const settings = resolveSettings(context.settings);

    const reportFromPresence = (presence: AttributePresence): void => {
      if (
        presence.checkedNode &&
        presence.defaultCheckedNode &&
        !settings.ignoreExclusiveCheckedAttribute
      ) {
        context.report({ node: presence.checkedNode, message: EXCLUSIVE_MESSAGE });
      }
      if (
        presence.checkedNode &&
        !presence.hasOnChangeOrReadOnly &&
        !settings.ignoreMissingProperties
      ) {
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
