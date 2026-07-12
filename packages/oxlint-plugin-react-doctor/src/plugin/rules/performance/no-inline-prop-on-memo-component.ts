import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { unwrapObjectIntegrityExpression } from "../../utils/unwrap-object-integrity-expression.js";

const isMemoCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "memo") return true;
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    node.callee.object.name === "React" &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "memo"
  )
    return true;
  return false;
};

// `memo(Comp, undefined)` normalizes to React's default shallow compare,
// and an identifier named `shallowEqual` (the react-redux idiom) is
// behaviorally the same — inline props defeat both exactly like the
// default comparator.
const isDefaultEquivalentComparator = (comparator: EsTreeNode | undefined): boolean =>
  isNodeOfType(comparator, "Identifier") &&
  (comparator.name === "undefined" || comparator.name === "shallowEqual");

// `memo(Comp, areEqual)` with a custom comparator decides re-renders on
// its own terms — an inline prop the comparator never inspects doesn't
// defeat memoization. We can't prove which props the comparator reads, so
// conservatively skip flagging inline props for such components.
const hasCustomComparator = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  (node.arguments?.length ?? 0) >= 2 &&
  !isDefaultEquivalentComparator(node.arguments?.[1]);

const isInlineReference = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const referenceNode = unwrapObjectIntegrityExpression(node, scopes);

  if (
    isNodeOfType(referenceNode, "ArrowFunctionExpression") ||
    isNodeOfType(referenceNode, "FunctionExpression") ||
    (isNodeOfType(referenceNode, "CallExpression") &&
      isNodeOfType(referenceNode.callee, "MemberExpression") &&
      isNodeOfType(referenceNode.callee.property, "Identifier") &&
      referenceNode.callee.property.name === "bind")
  )
    return "functions";

  if (isNodeOfType(referenceNode, "ObjectExpression")) return "objects";
  if (isNodeOfType(referenceNode, "ArrayExpression")) return "Arrays";
  if (isNodeOfType(referenceNode, "JSXElement") || isNodeOfType(referenceNode, "JSXFragment"))
    return "JSX";

  return null;
};

export const noInlinePropOnMemoComponent = defineRule({
  id: "no-inline-prop-on-memo-component",
  title: "Inline prop defeats memo()",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move the inline `() => ...` / `[]` / `{}` to a stable value with useMemo, useCallback, or module scope, so the memoized child stops redrawing on every parent render",
  create: (context: RuleContext) => {
    const memoizedComponentNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        if (isMemoCall(node.init) && !hasCustomComparator(node.init)) {
          memoizedComponentNames.add(node.id.name);
        }
      },
      ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
        if (
          node.declaration &&
          isNodeOfType(node.declaration, "CallExpression") &&
          isMemoCall(node.declaration) &&
          !hasCustomComparator(node.declaration)
        ) {
          const innerArgument = node.declaration.arguments?.[0];
          if (isNodeOfType(innerArgument, "Identifier")) {
            memoizedComponentNames.add(innerArgument.name);
          }
        }
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

        // `key` is a reserved prop React strips before the memo comparison,
        // so an inline `key` never defeats memoization. `ref` is NOT
        // stripped — the memo bailout also requires ref identity
        // (`compare(prev, next) && current.ref === workInProgress.ref`),
        // so an inline ref callback defeats memo like any other prop.
        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "key") {
          return;
        }

        const openingElement = node.parent;
        if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return;

        let elementName: string | null = null;
        if (isNodeOfType(openingElement.name, "JSXIdentifier")) {
          elementName = openingElement.name.name;
        }
        if (!elementName || !memoizedComponentNames.has(elementName)) return;

        const propType = isInlineReference(node.value.expression, context.scopes);
        if (propType) {
          context.report({
            node: node.value.expression,
            message: `This redraws ${elementName} on every render because the prop is ${propType} built right here, so memo() can't skip it. Move it to a stable value with useMemo, useCallback, or module scope`,
          });
        }
      },
    };
  },
});
