import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noFullLodashImport = defineRule({
  id: "no-full-lodash-import",
  title: "Full lodash import",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Import just the function you need: `import debounce from 'lodash/debounce'`. Saves about 70kb.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      // Type-only imports are erased at emit time, so they ship nothing.
      if (isTypeOnlyImport(node)) return;
      // `lodash-es` ships ES modules that bundlers can tree-shake
      // (each function is a separate file); only the legacy bundled
      // `lodash` import pulls the whole library. Flagging
      // `lodash-es` would just push users to a more awkward import
      // form for the same byte cost.
      if (source === "lodash") {
        context.report({
          node,
          message:
            "Importing all of lodash ships the whole library to your users & slows page load. Import from 'lodash/functionName' instead.",
        });
      }
    },
  }),
});
