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
    "ReactDOM.render is the legacy root API — switch to `import { createRoot } from 'react-dom/client'` and call `createRoot(container).render(...)` (REMOVED in React 19)",
  ],
  [
    "hydrate",
    "ReactDOM.hydrate is the legacy SSR API — switch to `import { hydrateRoot } from 'react-dom/client'` and call `hydrateRoot(container, <App />)` (REMOVED in React 19)",
  ],
  [
    "unmountComponentAtNode",
    "ReactDOM.unmountComponentAtNode no longer works on roots created with `createRoot` — keep a reference to the root and call `root.unmount()` instead (REMOVED in React 19)",
  ],
  [
    "findDOMNode",
    "ReactDOM.findDOMNode crawls the rendered tree and breaks composition — accept a ref directly and read `ref.current` (REMOVED in React 19)",
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
  return `react-dom/test-utils is removed in React 19. ${replacementText}`;
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
        "react-dom/test-utils is removed in React 19. Use `act` from `react` and `fireEvent` / `render` from `@testing-library/react` instead",
    });
  }
};

export const noReactDomDeprecatedApis = defineRule<Rule>({
  requires: ["react:18"],
  tags: ["test-noise"],
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Switch the legacy `react-dom` root API (`render` / `hydrate` / `unmountComponentAtNode`) to `createRoot` / `hydrateRoot` / `root.unmount()` from `react-dom/client`. Replace `findDOMNode` with a ref. The whole `react-dom/test-utils` entry point is removed in React 19 — use `act` from `react` and `fireEvent` / `render` from `@testing-library/react`. Only enabled on projects detected as React 18+.",
  examples: [
    {
      before:
        "import ReactDOM from 'react-dom';\nReactDOM.render(<App />, document.getElementById('root'));",
      after:
        "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(<App />);",
    },
  ],
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
