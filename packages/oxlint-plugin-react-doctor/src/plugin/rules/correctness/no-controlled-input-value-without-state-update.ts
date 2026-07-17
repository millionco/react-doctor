import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const CONTROLLED_INPUT_TAGS = new Set(["input", "textarea"]);

// `checked` drives radio/checkbox state, `hidden` never needs onChange, so a
// literal `value` on these is the submission token, not a frozen field.
const VALUE_BYPASS_INPUT_TYPES = new Set(["hidden", "checkbox", "radio"]);

const READONLY_ATTRIBUTES = ["readOnly", "disabled"];

const isNoOpChangeHandler = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const handler = stripParenExpression(attribute.value.expression);
  if (!isFunctionLike(handler)) return false;
  if (isNodeOfType(handler.body, "BlockStatement")) return handler.body.body.length === 0;
  const expression = stripParenExpression(handler.body);
  return (
    (isNodeOfType(expression, "Identifier") && expression.name === "undefined") ||
    (isNodeOfType(expression, "Literal") && expression.value === null)
  );
};

// True when the `value` JSXAttribute is a bare string/number literal —
// `value="x"` or `value={123}`. Identifier references (state, props, consts)
// are deliberately excluded: telling them apart needs scope analysis, and the
// applied revision keeps this detector syntax-only to avoid the prop FP.
const isLiteralValueAttribute = (valueAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = valueAttribute.value;
  if (!value) return false;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" || typeof value.value === "number";
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression: EsTreeNode = stripParenExpression(value.expression);
    return (
      isNodeOfType(expression, "Literal") &&
      (typeof expression.value === "string" || typeof expression.value === "number")
    );
  }
  return false;
};

// Mirrors `isLiteralValueAttribute`'s two accepted shapes for the `type`
// attribute: `type="radio"` and `type={"radio"}` both resolve statically.
const getStaticStringAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): string | null => {
  const value = attribute.value;
  if (!value) return null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return value.value;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression: EsTreeNode = stripParenExpression(value.expression);
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};

const HIDDEN_CLASS_PATTERN = /sr-only|visually-hidden|offscreen/i;

// Deliberately-empty controlled inputs are invisible or unfocusable by
// design: honeypot decoys (`tabIndex={-1}` + `aria-hidden`), and hidden
// typing-capture proxies (`className="sr-only"`) reset to "" after every
// change so each onChange delivers exactly the new character. Typing "doing
// nothing" is their contract, not a bug.
const hasHiddenOrDecoySignal = (attributes: EsTreeNode[]): boolean => {
  const ariaHidden = findJsxAttribute(attributes, "aria-hidden");
  if (ariaHidden) {
    const staticValue = getStaticStringAttributeValue(ariaHidden);
    if (ariaHidden.value === null || staticValue === "true") return true;
  }
  const tabIndex = findJsxAttribute(attributes, "tabIndex");
  if (tabIndex?.value && isNodeOfType(tabIndex.value, "JSXExpressionContainer")) {
    const expression = stripParenExpression(tabIndex.value.expression);
    if (
      isNodeOfType(expression, "UnaryExpression") &&
      expression.operator === "-" &&
      isNodeOfType(expression.argument, "Literal") &&
      expression.argument.value === 1
    ) {
      return true;
    }
  }
  const className = findJsxAttribute(attributes, "className");
  if (className) {
    const staticValue = getStaticStringAttributeValue(className);
    if (staticValue !== null && HIDDEN_CLASS_PATTERN.test(staticValue)) return true;
  }
  return false;
};

// A draft/commit branch pair renders a state-driven twin of the flagged
// element at the same tree position (`draft !== null ? <input value={draft}>
// : <input value="">`): the empty-literal branch is the idle state whose
// onChange swaps in the live branch, so typing works. Exempt the literal
// input when a sibling input/textarea in the same component reads its value
// from a non-literal expression.
const componentRendersStateDrivenSibling = (
  flaggedElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  let enclosingFunction: EsTreeNode | null = flaggedElement.parent ?? null;
  while (enclosingFunction && !isFunctionLike(enclosingFunction)) {
    enclosingFunction = enclosingFunction.parent ?? null;
  }
  if (!enclosingFunction) return false;
  let foundSibling = false;
  walkAst(enclosingFunction, (child) => {
    if (foundSibling) return false;
    if (child === flaggedElement || !isNodeOfType(child, "JSXOpeningElement")) return;
    if (!isNodeOfType(child.name, "JSXIdentifier") || !CONTROLLED_INPUT_TAGS.has(child.name.name)) {
      return;
    }
    const siblingValue = findJsxAttribute(child.attributes ?? [], "value");
    if (siblingValue && !isLiteralValueAttribute(siblingValue)) {
      foundSibling = true;
      return false;
    }
  });
  return foundSibling;
};

export const noControlledInputValueWithoutStateUpdate = defineRule({
  id: "no-controlled-input-value-without-state-update",
  title: "Controlled input value is a fixed literal",
  severity: "warn",
  tags: ["react-jsx-only"],
  recommendation:
    "Drive the input's `value` from state (`const [value, setValue] = useState(...)`) that `onChange` updates, or drop `value` if the field is meant to be read-only.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (!CONTROLLED_INPUT_TAGS.has(tagName)) return;

      const attributes = node.attributes ?? [];
      if (hasJsxSpreadAttribute(attributes)) return;

      const valueAttribute = findJsxAttribute(attributes, "value");
      if (!valueAttribute || !isLiteralValueAttribute(valueAttribute)) return;

      const onChangeAttribute = findJsxAttribute(attributes, "onChange");
      if (!onChangeAttribute || isNoOpChangeHandler(onChangeAttribute)) return;
      if (READONLY_ATTRIBUTES.some((name) => findJsxAttribute(attributes, name))) return;

      if (tagName === "input") {
        if (findJsxAttribute(attributes, "checked")) return;
        const typeAttribute = findJsxAttribute(attributes, "type");
        if (typeAttribute) {
          const inputType = getStaticStringAttributeValue(typeAttribute);
          if (inputType === null || VALUE_BYPASS_INPUT_TYPES.has(inputType)) return;
        }
      }

      if (hasHiddenOrDecoySignal(attributes)) return;
      if (componentRendersStateDrivenSibling(node)) return;

      context.report({
        node,
        message: `Typing does nothing in this <${tagName}> because its \`value\` is a fixed literal that \`onChange\` never updates, so drive \`value\` from state or drop it if the field should be read-only.`,
      });
    },
  }),
});
