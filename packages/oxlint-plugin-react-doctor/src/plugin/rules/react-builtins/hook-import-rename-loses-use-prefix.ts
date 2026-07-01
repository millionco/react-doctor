import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// eslint-plugin-react-hooks and the React Compiler recognise hooks ONLY by
// the `/^use[A-Z]/` naming convention on the call-site identifier — the same
// convention this rule enforces on the import alias. `useless` / `user` /
// bare `use` deliberately fail it: only `use` followed by an uppercase letter
// counts.
const HOOK_NAME_PATTERN = /^use[A-Z]/;

export const hookImportRenameLosesUsePrefix = defineRule({
  id: "hook-import-rename-loses-use-prefix",
  title: "Hook import alias drops the use prefix",
  severity: "warn",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Keep the `use` prefix in the alias (e.g. `useQuery as useProducts`) or import the hook without renaming. Hook linting recognises hooks only by their `use` name at the call site, so dropping the prefix silently turns off rules-of-hooks and exhaustive-deps for it.",
  create: (context: RuleContext) => ({
    ImportSpecifier(node: EsTreeNodeOfType<"ImportSpecifier">) {
      // A type-only hook import can never be called as a hook, so renaming
      // it changes nothing downstream — skip to avoid noise.
      if (node.importKind === "type") return;
      const declaration = node.parent;
      if (
        declaration &&
        isNodeOfType(declaration, "ImportDeclaration") &&
        declaration.importKind === "type"
      ) {
        return;
      }

      const importedName = getImportedName(node);
      if (!importedName || !HOOK_NAME_PATTERN.test(importedName)) return;

      const localName = node.local.name;
      // No rename (or the alias keeps a valid hook name) — still linted.
      if (localName === importedName || HOOK_NAME_PATTERN.test(localName)) return;

      context.report({
        node,
        message: `Renaming the "${importedName}" hook to "${localName}" turns off rules-of-hooks and exhaustive-deps for every call of it, so keep the "use" prefix in the alias.`,
      });
    },
  }),
});
