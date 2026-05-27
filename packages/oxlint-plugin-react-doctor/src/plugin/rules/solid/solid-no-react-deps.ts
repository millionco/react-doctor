import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TRACKED_PRIMITIVES: ReadonlyArray<string> = ["createEffect", "createMemo"];

// Port of `solid/no-react-deps` — Solid's `createEffect` /
// `createMemo` track their dependencies automatically. A second
// array-literal argument is the React-style dependency list, which
// has no effect (and the inline function ignoring its parameter is
// the dead giveaway that the user expects React semantics).
export const solidNoReactDeps = defineRule<Rule>({
  id: "solid-no-react-deps",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Solid's `createEffect` and `createMemo` track dependencies automatically — drop the React-style dep array.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedImport = importTracker.matchImport(TRACKED_PRIMITIVES, node.callee.name);
        if (!matchedImport) return;
        if (node.arguments.length !== 2) return;
        if (node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))) return;
        const firstArgument: EsTreeNode = node.arguments[0];
        const secondArgument = node.arguments[1];
        if (!isFunctionLike(firstArgument)) return;
        if (firstArgument.params.length !== 0) return;
        if (!isNodeOfType(secondArgument, "ArrayExpression")) return;
        context.report({
          node: secondArgument,
          message: `In Solid, \`${matchedImport}\` doesn't accept a dependency array because it tracks dependencies automatically. Use \`on\` if you need to override.`,
        });
      },
    };
  },
});
