import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { createDeprecatedReactImportRule } from "./utils/create-deprecated-react-import-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";

// HACK: companion to `noReact19DeprecatedApis` for the react-dom side
// of the React 19 migration. Catches the legacy root API (render /
// hydrate / unmountComponentAtNode) and findDOMNode. The whole
// `react-dom/test-utils` entry point is gone in 19; we flag every
// import from it and steer users to `act` from `react` plus
// `fireEvent` / `render` from @testing-library/react. Kept as a
// separate rule from `noReact19DeprecatedApis` so the per-source
// binding tracking stays simple — `react` and `react-dom` namespace
// imports never collide.
//
// Deliberately omitted: `useFormState`. It's the *current* correct API
// in React 18 (`react-dom`) — only renamed to `useActionState` and
// moved to `react` in 19. A whole-rule version gate (`>= 18`) can't
// distinguish "still on 18" from "should have migrated" inside the
// rule, so we drop the entry rather than false-positive on 18 code.
const REACT_DOM_DEPRECATED_MESSAGES = new Map<string, string>([
  [
    "render",
    "ReactDOM.render crashes your app in React 19 since it's gone, so import `createRoot` from `react-dom/client` & call `createRoot(container).render(...)`.",
  ],
  [
    "hydrate",
    "ReactDOM.hydrate crashes hydration in React 19 since it's gone, so import `hydrateRoot` from `react-dom/client` & call `hydrateRoot(container, <App />)`.",
  ],
  [
    "unmountComponentAtNode",
    "ReactDOM.unmountComponentAtNode won't unmount your tree in React 19 since it's gone, so keep the root you created & call `root.unmount()` instead.",
  ],
  [
    "findDOMNode",
    "ReactDOM.findDOMNode crashes in React 19 since it's gone, & it breaks composition anyway, so pass a ref & read `ref.current` instead.",
  ],
]);

const REACT_DOM_TEST_UTILS_REPLACEMENTS = new Map<string, string>([
  ["act", "`import { act } from 'react'` instead"],
  ["Simulate", "`fireEvent` from `@testing-library/react` instead"],
  ["renderIntoDocument", "`render` from `@testing-library/react` instead"],
  ["findRenderedDOMComponentWithTag", "`getByRole` / `getByTestId` from `@testing-library/react`"],
  ["findRenderedDOMComponentWithClass", "`getByRole` or `container.querySelector` from RTL"],
  ["scryRenderedDOMComponentsWithTag", "`getAllByRole` from `@testing-library/react`"],
]);

const buildTestUtilsMessage = (importedName: string): string => {
  const replacement = REACT_DOM_TEST_UTILS_REPLACEMENTS.get(importedName);
  const replacementText = replacement
    ? `Use ${replacement}.`
    : "Switch to `act` from `react` or the equivalent in `@testing-library/react`.";
  return `react-dom/test-utils is removed in React 19, so your tests break. ${replacementText}`;
};

const reportTestUtilsImports = (
  node: EsTreeNodeOfType<"ImportDeclaration">,
  context: RuleContext,
): void => {
  for (const specifier of node.specifiers ?? []) {
    if (isNodeOfType(specifier, "ImportSpecifier")) {
      const importedName = getImportedName(specifier) ?? "default";
      context.report({ node: specifier, message: buildTestUtilsMessage(importedName) });
      continue;
    }
    context.report({
      node: specifier,
      message:
        "react-dom/test-utils is removed in React 19, so your tests break. Use `act` from `react` & `fireEvent` / `render` from `@testing-library/react` instead",
    });
  }
};

export const noReactDomDeprecatedApis = defineRule<Rule>({
  id: "no-react-dom-deprecated-apis",
  title: "Deprecated react-dom APIs",
  requires: ["react:18"],
  // BOTH tags — the `defineRule` wrapper recognises that
  // "migration-hint" wins over "test-noise", so the rule still fires
  // on test files (where deprecated-API migration is the primary
  // surface) while keeping the rule self-documenting as test-noisy.
  tags: ["test-noise", "migration-hint"],
  severity: "warn",
  recommendation:
    "Switch the old `react-dom` root API (`render` / `hydrate` / `unmountComponentAtNode`) to `createRoot` / `hydrateRoot` / `root.unmount()` from `react-dom/client`. Replace `findDOMNode` with a ref. `react-dom/test-utils` is gone in React 19, so use `act` from `react` and `fireEvent` / `render` from `@testing-library/react`. Only runs on React 18+ projects.",
  ...createDeprecatedReactImportRule({
    source: "react-dom",
    messages: REACT_DOM_DEPRECATED_MESSAGES,
    handleExtraSource: (node, context) => {
      if (node.source?.value !== "react-dom/test-utils") return false;
      reportTestUtilsImports(node, context);
      return true;
    },
  }),
});
