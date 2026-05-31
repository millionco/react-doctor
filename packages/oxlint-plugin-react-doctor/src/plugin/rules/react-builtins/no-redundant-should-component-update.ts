import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (className: string): string =>
  `\`shouldComponentUpdate\` fights PureComponent's built-in check in \`${className}\` & can skip needed updates.`;

const isPureComponentSuper = (superClass: EsTreeNode | null): boolean => {
  if (!superClass) return false;
  if (isNodeOfType(superClass, "Identifier")) return superClass.name === "PureComponent";
  if (isNodeOfType(superClass, "MemberExpression")) {
    if (!isNodeOfType(superClass.object, "Identifier")) return false;
    if (superClass.object.name !== "React") return false;
    return (
      isNodeOfType(superClass.property, "Identifier") &&
      superClass.property.name === "PureComponent"
    );
  }
  return false;
};

const findShouldComponentUpdate = (classBody: EsTreeNodeOfType<"ClassBody">): EsTreeNode | null => {
  for (const member of classBody.body) {
    if (isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) {
      const key = member.key;
      if (isNodeOfType(key, "Identifier") && key.name === "shouldComponentUpdate") {
        return key;
      }
      if (isNodeOfType(key, "Literal") && key.value === "shouldComponentUpdate") {
        return key;
      }
    }
  }
  return null;
};

// Port of `oxc_linter::rules::react::no_redundant_should_component_update`.
// Reports `shouldComponentUpdate` defined on a `class extends
// React.PureComponent` (or bare `extends PureComponent`) — PureComponent
// already implements shallow-equal SCU, so the override is redundant.
export const noRedundantShouldComponentUpdate = defineRule<Rule>({
  id: "no-redundant-should-component-update",
  title: "Redundant shouldComponentUpdate",
  severity: "warn",
  recommendation:
    "Drop `shouldComponentUpdate` (PureComponent already shallow-compares) or extend `React.Component` if custom logic is needed.",
  category: "Architecture",
  create: (context) => {
    const checkClass = (
      classNode: EsTreeNodeOfType<"ClassDeclaration"> | EsTreeNodeOfType<"ClassExpression">,
    ): void => {
      if (!isPureComponentSuper(classNode.superClass ?? null)) return;
      const reportNode = findShouldComponentUpdate(classNode.body);
      if (!reportNode) return;
      const className = classNode.id?.name ?? "<anonymous class>";
      context.report({ node: reportNode, message: buildMessage(className) });
    };
    return {
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
    };
  },
});
