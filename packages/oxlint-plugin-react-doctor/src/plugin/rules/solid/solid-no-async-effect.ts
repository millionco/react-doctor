import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EFFECT_PRIMITIVES: ReadonlyArray<string> = [
  "createEffect",
  "createRenderEffect",
  "createComputed",
];

const containsAwaitExpression = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
): boolean => {
  let found = false;
  walkAst(callback, (node) => {
    if (found) return false;
    if (isFunctionLike(node) && node !== callback) return false;
    if (isNodeOfType(node, "AwaitExpression")) {
      found = true;
      return false;
    }
  });
  return found;
};

export const solidNoAsyncEffect = defineRule<Rule>({
  id: "solid-no-async-effect",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "After the first `await`, the tracking scope is lost — signals read after the await are NOT tracked and cleanup semantics break. Use `createResource` for async data fetching, or call the async function inside a synchronous effect.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedPrimitive = importTracker.matchImport(EFFECT_PRIMITIVES, node.callee.name);
        if (!matchedPrimitive) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0];
        if (!isFunctionLike(callback)) return;
        if (isNodeOfType(callback, "FunctionDeclaration")) return;

        const isAsync = Boolean(callback.async);
        const hasAwait = containsAwaitExpression(callback);

        if (isAsync || hasAwait) {
          context.report({
            node,
            message: `\`${matchedPrimitive}\` should not receive an async callback — after the first \`await\`, Solid's tracking scope is lost and signals read afterward won't be tracked.`,
          });
        }
      },
    };
  },
});
