import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "reduce",
  "reduceRight",
]);

// True when `fn` is the per-item callback of a known array iteration:
// receiver-method form (`arr.map(fn)` / `.forEach(fn)` / `.reduce(fn)`
// / etc.) where the callback is the first argument, OR
// `Array.from(iterable, fn)` where it's the second.
const isIteratorCallback = (fn: EsTreeNode): boolean => {
  const functionParent = fn.parent;
  if (!functionParent || !isNodeOfType(functionParent, "CallExpression")) return false;
  const callee = functionParent.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (functionParent.arguments[0] === fn && ITERATOR_METHOD_NAMES.has(callee.property.name)) {
    return true;
  }
  if (
    functionParent.arguments[1] === fn &&
    callee.property.name === "from" &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array"
  ) {
    return true;
  }
  return false;
};

// Style writes alone don't trigger reflow — the browser batches them.
// Layout thrashing happens when reads (`offsetHeight`,
// `getBoundingClientRect`, etc.) are interleaved with writes inside a
// loop. Sequential style writes outside a loop body are harmless; only
// flag when we can prove we're inside a loop / `.forEach` / `.map`
// body. The typical "build a DOM element by setting a few style props"
// pattern (no loop) is the dominant FP source — no reflow cost at all.
//
// Crossing a non-iterator function boundary (event handler arrow,
// setTimeout callback, etc.) stops the walk: the function's body runs
// in its own per-invocation scope, not per-iteration of the outer loop.
const isInsideLoopContext = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    ) {
      return true;
    }
    if (isFunctionLike(current)) {
      if (isIteratorCallback(current)) return true;
      return false;
    }
    current = current.parent ?? null;
  }
  return false;
};

export const jsBatchDomCss = defineRule<Rule>({
  id: "js-batch-dom-css",
  title: "Repeated inline style writes",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Do all your reads first, then all your writes. Mixing them inside a loop makes the browser recalculate the layout again and again, which is slow",
  create: (context: RuleContext) => {
    const isStyleAssignment = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "ExpressionStatement") &&
      isNodeOfType(node.expression, "AssignmentExpression") &&
      isNodeOfType(node.expression.left, "MemberExpression") &&
      isNodeOfType(node.expression.left.object, "MemberExpression") &&
      isNodeOfType(node.expression.left.object.property, "Identifier") &&
      node.expression.left.object.property.name === "style";

    return {
      BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
        if (!isInsideLoopContext(node)) return;
        const statements = node.body ?? [];
        for (let statementIndex = 1; statementIndex < statements.length; statementIndex++) {
          if (
            isStyleAssignment(statements[statementIndex]) &&
            isStyleAssignment(statements[statementIndex - 1])
          ) {
            context.report({
              node: statements[statementIndex],
              message:
                "This makes the browser recalculate layout again & again because you set several element.style properties in a row, so set them all at once with cssText or a CSS class to redraw once",
            });
          }
        }
      },
    };
  },
});
