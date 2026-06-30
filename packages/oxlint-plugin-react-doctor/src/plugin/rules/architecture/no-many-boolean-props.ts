import { BOOLEAN_PROP_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isBooleanPrefixedPropName } from "../../utils/is-boolean-prefixed-prop-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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
    if (!isBooleanPrefixedPropName(child.property.name)) return;
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
export const noManyBooleanProps = defineRule({
  id: "no-many-boolean-props",
  title: "Boolean prop combinations are hard to test",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Split boolean-heavy APIs into smaller components or named variants so combinations stay testable.",
  create: (context: RuleContext) => {
    const reportIfMany = (
      booleanLikePropNames: string[],
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (booleanLikePropNames.length >= BOOLEAN_PROP_THRESHOLD) {
        context.report({
          node: reportNode,
          message: `Component "${componentName}" takes ${booleanLikePropNames.length} on/off props (${booleanLikePropNames.slice(0, 3).join(", ")}…), which is hard to combine & test. Split it into smaller components or named variants.`,
        });
      }
    };

    const checkComponent = (
      functionNode: EsTreeNode,
      param: EsTreeNode | undefined,
      body: EsTreeNode | undefined,
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (!param) return;
      // The component gates (uppercase name) also match non-component
      // factories like `function CreateValidator(options) { … }`, whose
      // `options.isStrict` accesses look like boolean props. Require
      // actual render output before treating the param as component props.
      if (!functionContainsReactRenderOutput(functionNode, context.scopes)) return;
      if (isNodeOfType(param, "ObjectPattern")) {
        const booleanLikePropNames: string[] = [];
        for (const property of param.properties ?? []) {
          if (!isNodeOfType(property, "Property")) continue;
          const keyName = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
          if (!keyName) continue;
          if (isBooleanPrefixedPropName(keyName)) {
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
        checkComponent(node, node.params?.[0], node.body, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isInlineFunctionExpression(node.init)) return;
        checkComponent(node.init, node.init.params?.[0], node.init.body, node.id.name, node.id);
      },
    };
  },
});
