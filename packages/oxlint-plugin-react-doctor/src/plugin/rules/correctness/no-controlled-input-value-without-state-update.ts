import { defineRule } from "../../utils/define-rule.js";
import { areNodesOnExclusiveConditionalBranches } from "../../utils/are-nodes-on-exclusive-conditional-branches.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { isJsxAttributePotentiallyTruthy } from "../../utils/is-jsx-attribute-potentially-truthy.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const CONTROLLED_INPUT_TAGS = new Set(["input", "textarea"]);

const VALUE_BYPASS_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "file",
  "hidden",
  "image",
  "radio",
  "reset",
  "submit",
]);

const READONLY_ATTRIBUTES = ["readOnly", "disabled"];

const isIgnoredLiteralResult = (expression: EsTreeNode): boolean => {
  const strippedExpression = stripParenExpression(expression);
  return (
    (isNodeOfType(strippedExpression, "Identifier") && strippedExpression.name === "undefined") ||
    isNodeOfType(strippedExpression, "Literal") ||
    isLiteralVoidExpression(strippedExpression)
  );
};

const isNoOpChangeHandler = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const handler = stripParenExpression(attribute.value.expression);
  if (!isFunctionLike(handler)) return false;
  if (isNodeOfType(handler.body, "BlockStatement")) {
    if (handler.body.body.length === 0) return true;
    if (handler.body.body.length !== 1) return false;
    const statement = handler.body.body[0];
    return (
      isNodeOfType(statement, "ReturnStatement") &&
      (!statement.argument || isIgnoredLiteralResult(statement.argument))
    );
  }
  return isIgnoredLiteralResult(handler.body);
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
  const ariaHidden = getAuthoritativeJsxAttribute(attributes, "aria-hidden");
  if (ariaHidden) {
    const staticValue = getStaticStringAttributeValue(ariaHidden);
    if (ariaHidden.value === null || staticValue === "true") return true;
  }
  const tabIndex = getAuthoritativeJsxAttribute(attributes, "tabIndex");
  if (tabIndex?.value && isNodeOfType(tabIndex.value, "Literal")) {
    const tabIndexValue = Number(tabIndex.value.value);
    if (Number.isFinite(tabIndexValue) && tabIndexValue < 0) return true;
  }
  if (tabIndex?.value && isNodeOfType(tabIndex.value, "JSXExpressionContainer")) {
    const expression = stripParenExpression(tabIndex.value.expression);
    if (
      isNodeOfType(expression, "UnaryExpression") &&
      expression.operator === "-" &&
      isNodeOfType(expression.argument, "Literal") &&
      typeof expression.argument.value === "number" &&
      expression.argument.value > 0
    ) {
      return true;
    }
  }
  const className = getAuthoritativeJsxAttribute(attributes, "className");
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
const findReturnStatementAncestor = (
  node: EsTreeNode,
  boundary: EsTreeNode,
): EsTreeNodeOfType<"ReturnStatement"> | null => {
  let current = node.parent ?? null;
  while (current && current !== boundary) {
    if (isNodeOfType(current, "ReturnStatement")) return current;
    current = current.parent ?? null;
  }
  return null;
};

const conditionReferencesDynamicValue = (
  condition: EsTreeNode,
  dynamicValueKey: string,
  context: RuleContext,
): boolean => {
  let foundReference = false;
  walkAst(condition, (child) => {
    if (foundReference) return false;
    if (child !== condition && isFunctionLike(child)) return false;
    const conditionReferenceKey = serializeReferenceKey({ node: child, scopes: context.scopes });
    if (!conditionReferenceKey) return;
    if (
      conditionReferenceKey === dynamicValueKey ||
      dynamicValueKey.startsWith(`${conditionReferenceKey}.`)
    ) {
      foundReference = true;
    }
    return false;
  });
  return foundReference;
};

const elementsShareRelatedConditionalResult = (
  flaggedElement: EsTreeNode,
  siblingElement: EsTreeNode,
  boundary: EsTreeNode,
  dynamicValueKey: string,
  context: RuleContext,
): boolean => {
  if (!areNodesOnExclusiveConditionalBranches(flaggedElement, siblingElement, boundary)) {
    return false;
  }
  let ancestor = flaggedElement.parent ?? null;
  while (ancestor && ancestor !== boundary) {
    if (isNodeOfType(ancestor, "ConditionalExpression")) {
      const flaggedIsConsequent = isAstDescendant(flaggedElement, ancestor.consequent);
      const flaggedIsAlternate = isAstDescendant(flaggedElement, ancestor.alternate);
      const siblingIsConsequent = isAstDescendant(siblingElement, ancestor.consequent);
      const siblingIsAlternate = isAstDescendant(siblingElement, ancestor.alternate);
      if (
        ((flaggedIsConsequent && siblingIsAlternate) ||
          (flaggedIsAlternate && siblingIsConsequent)) &&
        conditionReferencesDynamicValue(ancestor.test, dynamicValueKey, context)
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const returnPathHasOnlyBlocks = (
  returnStatement: EsTreeNodeOfType<"ReturnStatement">,
  boundary: EsTreeNode,
): boolean => {
  let ancestor = returnStatement.parent ?? null;
  while (ancestor && ancestor !== boundary) {
    if (!isNodeOfType(ancestor, "BlockStatement")) return false;
    ancestor = ancestor.parent ?? null;
  }
  return ancestor === boundary;
};

const returnPathHasOnlyRelatedConditions = (
  returnStatement: EsTreeNodeOfType<"ReturnStatement">,
  boundary: EsTreeNode,
  dynamicValueKey: string,
  context: RuleContext,
): boolean => {
  let ancestor = returnStatement.parent ?? null;
  while (ancestor && ancestor !== boundary) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      ancestor = ancestor.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      conditionReferencesDynamicValue(ancestor.test, dynamicValueKey, context)
    ) {
      ancestor = ancestor.parent ?? null;
      continue;
    }
    return false;
  }
  return ancestor === boundary;
};

const returnsAreOppositeIfBranches = (
  flaggedReturn: EsTreeNodeOfType<"ReturnStatement">,
  siblingReturn: EsTreeNodeOfType<"ReturnStatement">,
  dynamicValueKey: string,
  context: RuleContext,
): boolean => {
  let ancestor = flaggedReturn.parent ?? null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "IfStatement") && ancestor.alternate) {
      const flaggedIsConsequent = isAstDescendant(flaggedReturn, ancestor.consequent);
      const flaggedIsAlternate = isAstDescendant(flaggedReturn, ancestor.alternate);
      const siblingIsConsequent = isAstDescendant(siblingReturn, ancestor.consequent);
      const siblingIsAlternate = isAstDescendant(siblingReturn, ancestor.alternate);
      if (
        ((flaggedIsConsequent && siblingIsAlternate) ||
          (flaggedIsAlternate && siblingIsConsequent)) &&
        conditionReferencesDynamicValue(ancestor.test, dynamicValueKey, context) &&
        returnPathHasOnlyRelatedConditions(flaggedReturn, ancestor, dynamicValueKey, context) &&
        returnPathHasOnlyRelatedConditions(siblingReturn, ancestor, dynamicValueKey, context)
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const conditionalReturnPrecedesFallback = (
  conditionalReturn: EsTreeNodeOfType<"ReturnStatement">,
  fallbackReturn: EsTreeNodeOfType<"ReturnStatement">,
  dynamicValueKey: string,
  context: RuleContext,
): boolean => {
  let conditionalAncestor = conditionalReturn.parent ?? null;
  while (conditionalAncestor) {
    if (isNodeOfType(conditionalAncestor, "IfStatement")) {
      const containingBlock = conditionalAncestor.parent;
      if (
        containingBlock &&
        isNodeOfType(containingBlock, "BlockStatement") &&
        fallbackReturn.parent === containingBlock
      ) {
        const conditionalIndex = containingBlock.body.findIndex(
          (statement) => statement === conditionalAncestor,
        );
        const fallbackIndex = containingBlock.body.findIndex(
          (statement) => statement === fallbackReturn,
        );
        if (conditionalIndex >= 0 && conditionalIndex < fallbackIndex) {
          return (
            returnPathHasOnlyBlocks(conditionalReturn, conditionalAncestor) &&
            conditionReferencesDynamicValue(conditionalAncestor.test, dynamicValueKey, context)
          );
        }
      }
    }
    conditionalAncestor = conditionalAncestor.parent ?? null;
  }
  return false;
};

const resultsAreAlternativeBranches = (
  flaggedElement: EsTreeNode,
  siblingElement: EsTreeNode,
  flaggedReturn: EsTreeNodeOfType<"ReturnStatement">,
  siblingReturn: EsTreeNodeOfType<"ReturnStatement">,
  dynamicValueKey: string,
  context: RuleContext,
): boolean => {
  if (flaggedReturn === siblingReturn) {
    return elementsShareRelatedConditionalResult(
      flaggedElement,
      siblingElement,
      flaggedReturn,
      dynamicValueKey,
      context,
    );
  }
  return (
    returnsAreOppositeIfBranches(flaggedReturn, siblingReturn, dynamicValueKey, context) ||
    conditionalReturnPrecedesFallback(flaggedReturn, siblingReturn, dynamicValueKey, context) ||
    conditionalReturnPrecedesFallback(siblingReturn, flaggedReturn, dynamicValueKey, context)
  );
};

const componentRendersStateDrivenAlternative = (
  flaggedElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let enclosingFunction: EsTreeNode | null = flaggedElement.parent ?? null;
  while (enclosingFunction && !isFunctionLike(enclosingFunction)) {
    enclosingFunction = enclosingFunction.parent ?? null;
  }
  if (!enclosingFunction) return false;
  const flaggedReturn = findReturnStatementAncestor(flaggedElement, enclosingFunction);
  if (!flaggedReturn) return false;
  let foundSibling = false;
  walkAst(enclosingFunction, (child) => {
    if (foundSibling) return false;
    if (child !== enclosingFunction && isFunctionLike(child)) return false;
    if (child === flaggedElement || !isNodeOfType(child, "JSXOpeningElement")) return;
    if (!isNodeOfType(child.name, "JSXIdentifier") || !CONTROLLED_INPUT_TAGS.has(child.name.name)) {
      return;
    }
    const siblingValue = getAuthoritativeJsxAttribute(child.attributes ?? [], "value");
    const siblingReturn = findReturnStatementAncestor(child, enclosingFunction);
    const dynamicValueKey =
      siblingValue?.value && isNodeOfType(siblingValue.value, "JSXExpressionContainer")
        ? serializeReferenceKey({ node: siblingValue.value.expression, scopes: context.scopes })
        : null;
    if (
      siblingValue &&
      !isLiteralValueAttribute(siblingValue) &&
      dynamicValueKey &&
      siblingReturn &&
      resultsAreAlternativeBranches(
        flaggedElement,
        child,
        flaggedReturn,
        siblingReturn,
        dynamicValueKey,
        context,
      )
    ) {
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
  create: (context: RuleContext) => {
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const tagName = node.name.name;
        if (!CONTROLLED_INPUT_TAGS.has(tagName)) return;

        const attributes = node.attributes ?? [];
        if (
          hasJsxSpreadAttribute(attributes) &&
          [
            "value",
            "onChange",
            "readOnly",
            "disabled",
            "className",
            "aria-hidden",
            "tabIndex",
            ...(tagName === "input" ? ["type", "checked"] : []),
          ].some((name) => getAuthoritativeJsxAttribute(attributes, name) === null)
        ) {
          return;
        }
        const valueAttribute = getAuthoritativeJsxAttribute(attributes, "value");
        if (!valueAttribute || !isLiteralValueAttribute(valueAttribute)) return;

        const onChangeAttribute = getAuthoritativeJsxAttribute(attributes, "onChange");
        if (!onChangeAttribute || isNoOpChangeHandler(onChangeAttribute)) return;
        if (
          READONLY_ATTRIBUTES.some((name) =>
            isJsxAttributePotentiallyTruthy(getAuthoritativeJsxAttribute(attributes, name)),
          )
        )
          return;

        if (tagName === "input") {
          if (isJsxAttributePotentiallyTruthy(getAuthoritativeJsxAttribute(attributes, "checked")))
            return;
          const typeAttribute = getAuthoritativeJsxAttribute(attributes, "type");
          if (typeAttribute) {
            const inputType = getStaticStringAttributeValue(typeAttribute);
            if (inputType === null || VALUE_BYPASS_INPUT_TYPES.has(inputType.toLowerCase())) return;
          }
        }

        if (hasHiddenOrDecoySignal(attributes)) return;
        if (componentRendersStateDrivenAlternative(node, context)) return;

        context.report({
          node,
          message: `Typing does nothing in this <${tagName}> because its \`value\` is a fixed literal that \`onChange\` never updates, so drive \`value\` from state or drop it if the field should be read-only.`,
        });
      },
    };
  },
});
