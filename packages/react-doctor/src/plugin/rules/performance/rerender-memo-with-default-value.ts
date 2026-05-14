import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rerenderMemoWithDefaultValue = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Move to module scope: `const EMPTY_ITEMS: Item[] = []` then use as the default value",
  examples: [
    {
      before: "function List({ items = [] }) { return <ul>{items.map(...)} </ul>; }",
      after:
        "const EMPTY_ITEMS: Item[] = [];\nfunction List({ items = EMPTY_ITEMS }) { return <ul>{items.map(...)} </ul>; }",
    },
  ],
  create: (context: RuleContext) => {
    const checkDefaultProps = (params: EsTreeNode[]): void => {
      for (const param of params) {
        if (!isNodeOfType(param, "ObjectPattern")) continue;
        for (const property of param.properties ?? []) {
          if (
            !isNodeOfType(property, "Property") ||
            !isNodeOfType(property.value, "AssignmentPattern")
          )
            continue;
          const defaultValue = property.value.right;
          if (
            isNodeOfType(defaultValue, "ObjectExpression") &&
            defaultValue.properties?.length === 0
          ) {
            context.report({
              node: defaultValue,
              message:
                "Default prop value {} creates a new object reference every render — extract to a module-level constant",
            });
          }
          if (
            isNodeOfType(defaultValue, "ArrayExpression") &&
            defaultValue.elements?.length === 0
          ) {
            context.report({
              node: defaultValue,
              message:
                "Default prop value [] creates a new array reference every render — extract to a module-level constant",
            });
          }
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkDefaultProps(node.params ?? []);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkDefaultProps(node.init.params ?? []);
      },
    };
  },
});
