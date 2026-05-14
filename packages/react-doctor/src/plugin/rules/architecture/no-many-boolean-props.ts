import { BOOLEAN_PROP_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const BOOLEAN_PROP_PREFIX_PATTERN = /^(?:is|has|should|can|show|hide|enable|disable|with)[A-Z]/;

const collectBooleanLikePropsFromBody = (
  componentBody: EsTreeNode | undefined,
  propsParamName: string,
): Set<string> => {
  const found = new Set<string>();
  if (!componentBody) return found;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "MemberExpression")) return;
    if (child.computed) return;
    if (!isNodeOfType(child.object, "Identifier")) return;
    if (child.object.name !== propsParamName) return;
    if (!isNodeOfType(child.property, "Identifier")) return;
    if (!BOOLEAN_PROP_PREFIX_PATTERN.test(child.property.name)) return;
    found.add(child.property.name);
  });
  return found;
};

// HACK: components with many boolean props (isLoading, hasIcon, showHeader,
// canEdit...) typically signal "many UI variants jammed into one component"
// — a sign that the component should be split via composition (compound
// components, explicit variant components). We use a name-based heuristic
// because TypeScript types aren't visible at this AST layer. Detects
// both destructured form (`{ isPrimary, hasIcon }`) and non-destructured
// (`function Foo(props) { props.isPrimary }`) by walking member-access
// patterns on the parameter binding.
export const noManyBooleanProps = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Split into compound components or named variants: `<Button.Primary />`, `<DialogConfirm />` instead of stacking `isPrimary`, `isConfirm` flags",
  examples: [
    {
      before:
        "function Button({ isPrimary, isLoading, hasIcon, isDisabled, showSpinner }) {\n  return <button />;\n}",
      after:
        "function PrimaryButton({ disabled, icon }) {\n  return <button disabled={disabled}>{icon}</button>;\n}",
    },
  ],
  create: (context: RuleContext) => {
    const reportIfMany = (
      booleanLikePropNames: string[],
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (booleanLikePropNames.length >= BOOLEAN_PROP_THRESHOLD) {
        context.report({
          node: reportNode,
          message: `Component "${componentName}" takes ${booleanLikePropNames.length} boolean-like props (${booleanLikePropNames.slice(0, 3).join(", ")}…) — consider compound components or explicit variants instead of stacking flags`,
        });
      }
    };

    const checkComponent = (
      param: EsTreeNode | undefined,
      body: EsTreeNode | undefined,
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (!param) return;
      if (isNodeOfType(param, "ObjectPattern")) {
        const booleanLikePropNames: string[] = [];
        for (const property of param.properties ?? []) {
          if (!isNodeOfType(property, "Property")) continue;
          const keyName = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
          if (!keyName) continue;
          if (BOOLEAN_PROP_PREFIX_PATTERN.test(keyName)) {
            booleanLikePropNames.push(keyName);
          }
        }
        reportIfMany(booleanLikePropNames, componentName, reportNode);
        return;
      }
      if (isNodeOfType(param, "Identifier")) {
        const accessed = collectBooleanLikePropsFromBody(body, param.name);
        reportIfMany([...accessed], componentName, reportNode);
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        checkComponent(node.params?.[0], node.body, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.params?.[0], node.init.body, node.id.name, node.id);
      },
    };
  },
});
