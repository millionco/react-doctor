import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactRouterRequireRootErrorBoundary } from "./react-router-require-root-error-boundary.js";

describe("data router root error boundaries", () => {
  it.each([
    `import { useRoutes } from 'react-router-dom'; const Screen = () => useRoutes([{ path: '/', element: <Page /> }]);`,
    `import { useRoutes as routes } from 'react-router'; const Screen = () => routes([{ path: '/', element: <Page /> }]);`,
  ])("does not require data-router error UI for declarative routes", (code) => {
    const result = runRule(reactRouterRequireRootErrorBoundary, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["createBrowserRouter", "createHashRouter", "createMemoryRouter"])(
    "retains the boundary requirement for %s",
    (factory) => {
      const result = runRule(
        reactRouterRequireRootErrorBoundary,
        `import { ${factory} as createRouter } from 'react-router-dom'; createRouter([{ path: '/', element: <Page /> }]);`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("does not suppress a factory aliased as useRoutes", () => {
    const result = runRule(
      reactRouterRequireRootErrorBoundary,
      `import { createBrowserRouter as useRoutes } from 'react-router-dom'; useRoutes([{ path: '/', element: <Page /> }]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
