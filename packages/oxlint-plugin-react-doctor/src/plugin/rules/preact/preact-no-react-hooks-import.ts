import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const REACT_HOOK_NAMES = new Set([
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
]);

const buildMessage = (importedNames: ReadonlyArray<string>): string =>
  `Your users hit \`__H\` undefined errors because importing ${importedNames.map((innerName) => `\`${innerName}\``).join(", ")} from \`react\` in a pure-Preact project loads a second copy of the hook state, so import from \`preact/hooks\` (or \`preact/compat\`) instead.`;

// In a pure-Preact app, hooks must come from `preact/hooks` so they share
// the same Preact module instance the renderer uses. Importing `useState` /
// `useEffect` etc. from `react` either loads a real React copy (which the
// Preact renderer cannot drive) or — under bundler aliasing — silently
// routes through `preact/compat`, but the latter only works when compat is
// wired up in the build. The `preact-hooks-debugging` skill explicitly cites
// this as the most common cause of the "Cannot read properties of undefined
// (reading '__H')" runtime error.
//
// Gated on `pure-preact` (Preact in deps AND no `react` package). When
// `react` IS installed alongside Preact the project is almost certainly
// using `preact/compat` aliasing, and importing from `react` is exactly how
// compat is meant to be consumed — flagging it there would be a false
// positive.
export const preactNoReactHooksImport = defineRule<Rule>({
  id: "preact-no-react-hooks-import",
  title: "React hook imports break pure Preact hook state",
  requires: ["pure-preact"],
  severity: "warn",
  recommendation:
    "Import hooks from `preact/hooks` so they share Preact's renderer state instead of loading a second hook implementation.",
  create: (context) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source;
      if (!isNodeOfType(source, "Literal") || source.value !== "react") return;
      const reactHookSpecifiers: EsTreeNodeOfType<"ImportSpecifier">[] = [];
      for (const specifier of node.specifiers) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const imported = specifier.imported;
        if (!isNodeOfType(imported, "Identifier")) continue;
        if (REACT_HOOK_NAMES.has(imported.name)) {
          reactHookSpecifiers.push(specifier);
        }
      }
      if (reactHookSpecifiers.length === 0) return;
      const importedNames = reactHookSpecifiers.map((specifier) => {
        const imported = specifier.imported;
        return isNodeOfType(imported, "Identifier") ? imported.name : "";
      });
      context.report({ node, message: buildMessage(importedNames) });
    },
  }),
});
