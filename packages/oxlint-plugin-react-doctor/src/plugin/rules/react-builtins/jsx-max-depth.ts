import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (depth: number, max: number): string =>
  `This JSX is hard to read at ${depth} levels deep, past the limit of ${max}.`;

// Default depth threshold: 14. OXC's `max: 2` default is far too strict
// for real-world React UIs — a routine shadcn Card already exceeds it
// (`<Card><CardHeader><CardTitle/></CardHeader></Card>` = depth 3).
// Real apps with Provider stacks + composed layouts + design-system
// wrappers regularly hit depth 10-13 (Excalidraw, tldraw, Linear-style
// shells). 14 catches genuinely-unreadable trees (depth >= ~15 is a
// real warning) without flagging idiomatic composition. Tunable per
// project via `jsxMaxDepth.max`.
const DEFAULT_MAX_DEPTH = 14;

interface JsxMaxDepthSettings {
  max?: number;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxMaxDepthSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxMaxDepth?: JsxMaxDepthSettings }).jsxMaxDepth ?? {})
      : {};
  return { max: ruleSettings.max ?? DEFAULT_MAX_DEPTH };
};

const isLeafJsxNode = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXElement") && !isNodeOfType(node, "JSXFragment")) return true;
  const children = (node as { children: ReadonlyArray<EsTreeNode> }).children;
  for (const child of children) {
    if (isNodeOfType(child, "JSXElement") || isNodeOfType(child, "JSXFragment")) return false;
  }
  return true;
};

const computeJsxAncestorDepth = (node: EsTreeNode): number => {
  let depth = 0;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") || isNodeOfType(ancestor, "JSXFragment")) depth += 1;
    ancestor = ancestor.parent ?? null;
  }
  return depth;
};

const computeExpressionDepth = (expression: EsTreeNode, visited: Set<string>): number => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "JSXElement") || isNodeOfType(stripped, "JSXFragment")) {
    const children = (stripped as { children: ReadonlyArray<EsTreeNode> }).children;
    return computeChildrenDepth(children, visited);
  }
  if (isNodeOfType(stripped, "Identifier")) {
    if (visited.has(stripped.name)) return 0;
    visited.add(stripped.name);
    const binding = findVariableInitializer(stripped, stripped.name);
    if (!binding || !binding.initializer) return 0;
    return computeExpressionDepth(binding.initializer, visited);
  }
  return 0;
};

const computeChildrenDepth = (
  children: ReadonlyArray<EsTreeNode>,
  visited: Set<string>,
): number => {
  let maxDepth = 0;
  for (const child of children) {
    let depth = 0;
    if (isNodeOfType(child, "JSXElement") || isNodeOfType(child, "JSXFragment")) {
      const innerChildren = (child as { children: ReadonlyArray<EsTreeNode> }).children;
      depth = computeChildrenDepth(innerChildren, visited) + 1;
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      const inner = child.expression;
      if (inner && inner.type !== "JSXEmptyExpression") {
        const resolved = computeExpressionDepth(inner as EsTreeNode, visited);
        depth = resolved > 0 ? resolved + 1 : 0;
      }
    }
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth;
};

// Port of `oxc_linter::rules::react::jsx_max_depth`. Walks each leaf
// JSX node (no JSXElement/JSXFragment children), counts its
// ancestor JSX depth, and adds the depth of any `{identifier}` /
// `{<jsxSubtree/>}` children — recursing through bindings via our
// initializer-tracker. Cycles in binding references (`x → y → x`) are
// broken by name.
export const jsxMaxDepth = defineRule<Rule>({
  id: "jsx-max-depth",
  title: "JSX nested too deeply",
  severity: "warn",
  tags: ["test-noise"],
  recommendation: "Pull deeply nested JSX into smaller components so it's easier to read.",
  category: "Architecture",
  create: (context) => {
    const { max } = resolveSettings(context.settings);
    const checkNode = (node: EsTreeNode): void => {
      if (!isLeafJsxNode(node)) return;
      const ancestorDepth = computeJsxAncestorDepth(node);
      const children = (node as { children?: ReadonlyArray<EsTreeNode> }).children ?? [];
      const childDepth = computeChildrenDepth(children, new Set<string>());
      const total = ancestorDepth + childDepth;
      if (total > max) {
        context.report({ node, message: buildMessage(total, max) });
      }
    };
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        checkNode(node);
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        checkNode(node);
      },
    };
  },
});
