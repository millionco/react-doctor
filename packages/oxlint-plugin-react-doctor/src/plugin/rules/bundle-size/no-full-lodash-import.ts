import { defineRule } from "../../utils/define-rule.js";
import { isImportAbsentFromClientBundle } from "../../utils/is-import-absent-from-client-bundle.js";
import { isInsideNodeCliPackage } from "../../utils/is-inside-node-cli-package.js";
import { isNodeTargetedModule } from "../../utils/is-node-targeted-module.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { moduleReferencesReact } from "../../utils/module-references-react.js";
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
      // `lodash-es` ships ES modules that bundlers can tree-shake
      // (each function is a separate file); only the legacy bundled
      // `lodash` import pulls the whole library. Flagging
      // `lodash-es` would just push users to a more awkward import
      // form for the same byte cost.
      if (source !== "lodash") return;
      // Type-only imports are erased at emit time, so they ship nothing.
      if (isTypeOnlyImport(node)) return;
      // Bindings referenced only in type positions or Next.js server data
      // functions never reach the client bundle either.
      if (isImportAbsentFromClientBundle(node)) return;
      // Node-only code (build scripts, CLIs, framework internals) has no
      // user-facing bundle for the full import to bloat.
      if (isNodeTargetedModule(node)) return;
      // Non-React files inside a bin-bearing package (gatsby's build
      // internals, a CLI's server code) run in the Node process; only the
      // React-rendering files of such packages reach a browser.
      if (isInsideNodeCliPackage(context.filename) && !moduleReferencesReact(node)) return;
      context.report({
        node,
        message:
          "Importing all of lodash ships the whole library to your users & slows page load. Import from 'lodash/functionName' instead.",
      });
    },
  }),
});
