import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { unwrapObjectIntegrityExpression } from "../../utils/unwrap-object-integrity-expression.js";
import { isIdentitySensitiveMemoComparator } from "../../utils/has-custom-memo-comparator.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";

const MEMO_CALLEE_NAMES: ReadonlySet<string> = new Set(["memo", "React.memo"]);

const isMemoCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  MEMO_CALLEE_NAMES.has(flattenCalleeName(node.callee) ?? "");

// `memo(Comp, areEqual)` with a custom comparator decides re-renders on
// its own terms — an inline prop the comparator never inspects doesn't
// defeat memoization. We can't prove which props the comparator reads, so
// conservatively skip flagging inline props for such components.
const hasCustomComparator = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const comparator = node.arguments?.[1];
  return comparator ? !isIdentitySensitiveMemoComparator(comparator, scopes) : false;
};

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
  // React Compiler memoizes inline prop allocations, so they keep their
  // identity between renders and no longer defeat `memo()`. Mirrors the
  // `jsx-no-new-*-as-prop` rules, which gate on the same capability.
  disabledWhen: ["react-compiler"],
  recommendation:
    "Move the inline `() => ...` / `[]` / `{}` to a stable value with useMemo, useCallback, or module scope, so the memoized child stops redrawing on every parent render",
  create: (context: RuleContext) => {
    const memoizedComponentNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        if (isMemoCall(node.init) && !hasCustomComparator(node.init, context.scopes)) {
          memoizedComponentNames.add(node.id.name);
        }
      },
      ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
        if (
          node.declaration &&
          isNodeOfType(node.declaration, "CallExpression") &&
          isMemoCall(node.declaration) &&
          !hasCustomComparator(node.declaration, context.scopes)
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
