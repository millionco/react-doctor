import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";

// eslint-plugin-react-hooks and the React Compiler recognise hooks by the
// `/^use[A-Z0-9]/` naming convention on the call-site identifier (their
// `isHookName`), so digit names like `use2FA` / `use100vh` count as hooks
// while `useless` / `user` deliberately fail it. Bare `use` also counts as
// a hook name for the ALIAS (linting stays on), but not for the IMPORTED
// name — non-React `use` exports (e.g. chai's) are not hooks.
const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

const isRecognizedHookAlias = (name: string): boolean =>
  name === "use" || HOOK_NAME_PATTERN.test(name);

const isInvokedAsCallee = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(parent && isNodeOfType(parent, "CallExpression") && parent.callee === identifier);
};

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
      if (isNonSourceFilename(context.filename)) return;
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
      if (localName === importedName || isRecognizedHookAlias(localName)) return;

      // Hook linting is only lost at call sites. An alias that is never
      // invoked — only reassigned, re-exported, or used as a value (the
      // Radix SSR-safe useLayoutEffect wrapper idiom) — keeps rules-of-hooks
      // and exhaustive-deps coverage intact wherever the flow lands.
      const aliasSymbol = context.scopes.symbolFor(node.local);
      if (!aliasSymbol) return;
      const invokedReferences = aliasSymbol.references.filter((reference) =>
        isInvokedAsCallee(reference.identifier),
      );
      if (invokedReferences.length === 0) return;

      // The rename-to-wrap idiom: `import { useNavigate as RRDuseNavigate }`
      // freeing the name for a same-file `export function useNavigate()`
      // wrapper. Every call of the alias lives inside the wrapper that
      // re-binds the ORIGINAL hook name, so external call sites keep full
      // hook-lint coverage and the rename is the only way to spell the wrap.
      const isEveryCallInsideSameNameWrapper = invokedReferences.every((reference) => {
        const enclosingFunction = findEnclosingFunction(reference.identifier);
        return Boolean(
          enclosingFunction &&
          componentOrHookDisplayNameForFunction(enclosingFunction) === importedName,
        );
      });
      if (isEveryCallInsideSameNameWrapper) return;

      context.report({
        node,
        message: `Renaming the "${importedName}" hook to "${localName}" turns off rules-of-hooks and exhaustive-deps for every call of it, so keep the "use" prefix in the alias.`,
      });
    },
  }),
});
