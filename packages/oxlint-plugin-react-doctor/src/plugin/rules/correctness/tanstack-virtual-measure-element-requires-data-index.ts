import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const TANSTACK_VIRTUAL_MODULES = ["@tanstack/react-virtual"];
const MEASURE_ELEMENT_NAME = "measureElement";
const DEFAULT_INDEX_ATTRIBUTE = "data-index";

const isMeasureElementReference = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier")) return expression.name === MEASURE_ELEMENT_NAME;
  return (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === MEASURE_ELEMENT_NAME
  );
};

// `ref={virtualizer.measureElement}`, `ref={measureElement}`, and the
// callback form `ref={(node) => virtualizer.measureElement(node)}`.
const isMeasureElementRefValue = (rawExpression: EsTreeNode): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isMeasureElementReference(expression)) return true;
  if (
    !isNodeOfType(expression, "ArrowFunctionExpression") ||
    !isNodeOfType(expression.body, "CallExpression")
  ) {
    return false;
  }
  return isMeasureElementReference(stripParenExpression(expression.body.callee));
};

// The virtualizer's `indexAttribute` option renames the attribute it reads;
// when a file configures it, the default-name check no longer applies.
const fileConfiguresCustomIndexAttribute = (node: EsTreeNode): boolean => {
  const programRoot = findProgramRoot(node);
  if (!programRoot) return false;
  let foundCustomIndexAttribute = false;
  walkAst(programRoot, (candidate) => {
    if (foundCustomIndexAttribute) return false;
    if (
      isNodeOfType(candidate, "Property") &&
      getStaticPropertyKeyName(candidate) === "indexAttribute"
    ) {
      foundCustomIndexAttribute = true;
    }
  });
  return foundCustomIndexAttribute;
};

export const tanstackVirtualMeasureElementRequiresDataIndex = defineRule({
  id: "tanstack-virtual-measure-element-requires-data-index",
  title: "Measured virtual item without data-index",
  severity: "warn",
  category: "Correctness",
  requires: ["tanstack-virtual"],
  matchByOccurrence: true,
  recommendation:
    "Add data-index={virtualItem.index} to every element whose ref is the virtualizer's measureElement, so dynamic measurement can attribute the size to the right row.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const refAttribute = findJsxAttribute(node.attributes, "ref");
      if (
        !refAttribute?.value ||
        !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
        !isMeasureElementRefValue(refAttribute.value.expression)
      ) {
        return;
      }
      if (!hasImportFromModules(node, TANSTACK_VIRTUAL_MODULES)) return;
      // A spread can supply data-index at runtime.
      if (hasJsxSpreadAttribute(node.attributes)) return;
      if (findJsxAttribute(node.attributes, DEFAULT_INDEX_ATTRIBUTE)) return;
      if (fileConfiguresCustomIndexAttribute(node)) return;
      context.report({
        node: node.name,
        message:
          "This element's ref is the virtualizer's measureElement, but it has no data-index attribute, so the virtualizer cannot attribute the measured size to a row and drops it with a console warning. Add data-index={virtualItem.index}.",
      });
    },
  }),
});
