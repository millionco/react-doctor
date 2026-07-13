import { defineRule } from "../../utils/define-rule.js";
import { isProvenReactClassComponent } from "../../utils/is-proven-react-class-component.js";
import { isProvenReactComponentSymbol } from "../../utils/is-proven-react-component-symbol.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

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
// The whole rule is version-gated on `react:19` so pre-19 projects —
// where `propTypes` still runs — stay quiet.
const PROP_TYPES_PROPERTY = "propTypes";

const isPropTypesKey = (key: EsTreeNode | null | undefined, computed: boolean): boolean => {
  if (!key) return false;
  if (computed) return isNodeOfType(key, "Literal") && key.value === PROP_TYPES_PROPERTY;
  return isNodeOfType(key, "Identifier") && key.name === PROP_TYPES_PROPERTY;
};

const getComponentFromPropTypesAssignment = (
  left: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(left, "MemberExpression")) return null;
  if (!isPropTypesKey(left.property, Boolean(left.computed))) return null;
  const receiver = stripParenExpression(left.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  if (!isUppercaseName(receiver.name)) return null;
  return receiver;
};

const getComponentNameFromClassProperty = (
  node: EsTreeNodeOfType<"PropertyDefinition">,
  scopes: ScopeAnalysis,
): string | null => {
  if (!node.static) return null;
  if (!isPropTypesKey(node.key, Boolean(node.computed))) return null;
  const classNode = isNodeOfType(node.parent, "ClassBody") ? node.parent.parent : null;
  if (!classNode || !isProvenReactClassComponent(classNode, scopes)) return null;

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
  `${componentName}.propTypes does nothing in React 19, so bad props reach your users with no warning. Describe props with TypeScript types & check risky data yourself.`;

export const noPropTypes = defineRule({
  id: "no-prop-types",
  title: "propTypes ignored in React 19",
  requires: ["react:19"],
  tags: ["test-noise"],
  severity: "warn",
  // Default off: `propTypes` are dead in a TypeScript codebase, where types
  // are the source of truth. Opt in to enforce it.
  defaultEnabled: false,
  recommendation:
    "React 19 ignores `Component.propTypes`, so invalid props pass silently. Describe props with TypeScript types and add real runtime checks (or schema parsing) only where data can actually be wrong. Only runs on React 19+ projects.",
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      const component = getComponentFromPropTypesAssignment(node.left);
      if (!component) return;
      const symbol = context.scopes.symbolFor(component);
      if (
        !symbol ||
        !isProvenReactComponentSymbol(symbol, context.scopes, context.cfg, component)
      ) {
        return;
      }
      context.report({ node: node.left, message: buildMessage(component.name) });
    },
    PropertyDefinition(node: EsTreeNodeOfType<"PropertyDefinition">) {
      const componentName = getComponentNameFromClassProperty(node, context.scopes);
      if (!componentName) return;
      context.report({ node: node.key, message: buildMessage(componentName) });
    },
  }),
});
