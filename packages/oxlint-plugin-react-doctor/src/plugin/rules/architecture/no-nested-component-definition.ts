import { defineRule } from "../../utils/define-rule.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface NestedComponentCandidate {
  reportNode: EsTreeNode;
  name: string;
  enclosingName: string;
  enclosingNode: EsTreeNode;
}

interface RenderedJsxElement {
  name: string;
  node: EsTreeNode;
}

interface EnclosingComponent {
  name: string;
  node: EsTreeNode;
}

export const noNestedComponentDefinition = defineRule({
  id: "no-nested-component-definition",
  title: "Component defined inside another component",
  tags: ["test-noise", "react-jsx-only"],
  // Aligned with `no-unstable-nested-components` (react-builtins), which
  // reports the same defect class: the two co-fire on the same nested
  // component, and one blocking while the other warns was incoherent.
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Move it to module scope or a separate file so React does not recreate the component and erase its state on every parent render.",
  create: (context: RuleContext) => {
    const componentStack: EnclosingComponent[] = [];
    const candidates: NestedComponentCandidate[] = [];
    // Only a PascalCase binding that is actually RENDERED — as a JSX
    // element (`<Name/>`) or passed by reference through a component prop
    // (`<Route component={Name}/>`) — creates a child fiber that React
    // remounts. A capitalized helper that is exclusively invoked as
    // `Name()` is inlined into the parent's render (no separate fiber, no
    // state to lose), so requiring render-site membership before reporting
    // drops the inline-render-helper false positives. Each render site is
    // kept with its node so the membership test can be scoped to the
    // candidate's own enclosing component: a `<Inner/>` rendered in a
    // SIBLING component refers to that sibling's binding, not this one.
    const renderedJsxElements: RenderedJsxElement[] = [];

    const pushCandidate = (reportNode: EsTreeNode, name: string, enclosingNode: EsTreeNode) => {
      if (componentStack.length > 0) {
        const enclosing = componentStack[componentStack.length - 1];
        candidates.push({
          reportNode,
          name,
          enclosingName: enclosing.name,
          enclosingNode: enclosing.node,
        });
      }
      componentStack.push({ name, node: enclosingNode });
    };

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && isUppercaseName(node.name.name)) {
          renderedJsxElements.push({ name: node.name.name, node });
        }
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const attributeExpression = node.value.expression;
        if (
          isNodeOfType(attributeExpression, "Identifier") &&
          isUppercaseName(attributeExpression.name)
        ) {
          renderedJsxElements.push({ name: attributeExpression.name, node });
        }
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        pushCandidate(node.id, node.id.name, node);
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (isComponentDeclaration(node)) componentStack.pop();
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        pushCandidate(node.id, node.id.name, node);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) componentStack.pop();
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          const isRenderedInEnclosingComponent = renderedJsxElements.some(
            (element) =>
              element.name === candidate.name &&
              isAstDescendant(element.node, candidate.enclosingNode),
          );
          if (!isRenderedInEnclosingComponent) continue;
          context.report({
            node: candidate.reportNode,
            message: `Your users lose all state in "${candidate.name}" on every render because it's defined inside "${candidate.enclosingName}", so move it out to the top of the file.`,
          });
        }
      },
    };
  },
});
