import { defineRule } from "../../utils/define-rule.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: React 19 removed runtime `propTypes` validation entirely —
// React no longer reads `Component.propTypes`, so invalid props that
// used to log a console warning now pass silently. The fix is the same
// across both component shapes (function and class): move the contract
// to TypeScript types and add explicit runtime checks only where data
// can actually be invalid. Detection targets two idioms:
//
//   Component.propTypes = { value: PropTypes.number };   // assignment
//   class Component { static propTypes = { ... }; }       // class field
//
// The uppercase-receiver heuristic (mirrors `no-default-props`) keeps
// the rule conservative: only a Capitalized identifier / class name is
// treated as a component, so `config.propTypes = …` on a lowercase
// object is never flagged. The whole rule is version-gated on
// `react:19` so pre-19 projects — where `propTypes` still runs — stay
// quiet.
const PROP_TYPES_PROPERTY = "propTypes";

const isPropTypesKey = (key: EsTreeNode | null | undefined, computed: boolean): boolean => {
  if (!key) return false;
  if (computed) return isNodeOfType(key, "Literal") && key.value === PROP_TYPES_PROPERTY;
  return isNodeOfType(key, "Identifier") && key.name === PROP_TYPES_PROPERTY;
};

const getComponentNameFromPropTypesAssignment = (left: EsTreeNode): string | null => {
  if (!isNodeOfType(left, "MemberExpression")) return null;
  if (!isPropTypesKey(left.property, Boolean(left.computed))) return null;
  if (!isNodeOfType(left.object, "Identifier")) return null;
  if (!isUppercaseName(left.object.name)) return null;
  return left.object.name;
};

const getComponentNameFromClassProperty = (
  node: EsTreeNodeOfType<"PropertyDefinition">,
): string | null => {
  if (!node.static) return null;
  if (!isPropTypesKey(node.key, Boolean(node.computed))) return null;

  const classBody = node.parent;
  if (!isNodeOfType(classBody, "ClassBody")) return null;
  const classNode = classBody.parent;
  if (!classNode) return null;

  if (
    (isNodeOfType(classNode, "ClassDeclaration") || isNodeOfType(classNode, "ClassExpression")) &&
    classNode.id?.name &&
    isUppercaseName(classNode.id.name)
  ) {
    return classNode.id.name;
  }

  if (!isNodeOfType(classNode, "ClassExpression")) return null;
  const declarator = classNode.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "Identifier")) return null;
  if (!isUppercaseName(declarator.id.name)) return null;
  return declarator.id.name;
};

const buildMessage = (componentName: string): string =>
  `${componentName}.propTypes — React 19 no longer runs \`propTypes\` checks, so invalid props pass silently. Move the prop contract to TypeScript types and add explicit runtime validation only where data can actually be invalid`;

export const noPropTypes = defineRule<Rule>({
  id: "no-prop-types",
  requires: ["react:19"],
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "React 19 removed runtime `propTypes` validation — React no longer reads `Component.propTypes`, so invalid props pass silently. Describe props with TypeScript types and move any required runtime validation to explicit checks (or schema parsing) in component code. Only enabled on projects detected as React 19+.",
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      const componentName = getComponentNameFromPropTypesAssignment(node.left);
      if (!componentName) return;
      context.report({ node: node.left, message: buildMessage(componentName) });
    },
    PropertyDefinition(node: EsTreeNodeOfType<"PropertyDefinition">) {
      const componentName = getComponentNameFromClassProperty(node);
      if (!componentName) return;
      context.report({ node: node.key, message: buildMessage(componentName) });
    },
  }),
});
