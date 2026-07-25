import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartMissingScripts } from "./tanstack-start-missing-scripts.js";

const ROOT_ROUTE_FILENAME = "src/routes/__root.tsx";

const runMissingScriptsRule = (code: string, filename = ROOT_ROUTE_FILENAME) =>
  runRule(tanstackStartMissingScripts, code, { filename });

describe("tanstack-start/missing-scripts", () => {
  it("flags root route document bodies without Scripts", () => {
    const result = runMissingScriptsRule(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head />
            <body>
              <main>Home</main>
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows direct Scripts usage inside the document body", () => {
    const result = runMissingScriptsRule(`
      import { Scripts } from "@tanstack/react-router";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <main>Home</main>
              <Scripts />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags Scripts rendered outside the document body", () => {
    const result = runMissingScriptsRule(`
      import { Scripts } from "@tanstack/react-router";

      export const Route = createRootRoute({
        component: () => (
          <>
            <Scripts />
            <html>
              <body />
            </html>
          </>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows aliased Scripts imports from project barrels", () => {
    const result = runMissingScriptsRule(`
      import { Scripts as RouterScripts } from "@/router-components";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <RouterScripts />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows TanStack Router namespace usage", () => {
    const result = runMissingScriptsRule(`
      import * as TanStackRouter from "@tanstack/react-router";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <TanStackRouter.Scripts />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows local wrapper components that render Scripts", () => {
    const result = runMissingScriptsRule(`
      import { Scripts } from "@tanstack/react-router";

      const AppScripts = () => <Scripts />;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <AppScripts />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows wrappers declared after the root route", () => {
    const result = runMissingScriptsRule(`
      import { Scripts } from "@tanstack/react-router";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <AppScripts />
            </body>
          </html>
        ),
      });

      function AppScripts() {
        return <Scripts />;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows nested local wrappers that render Scripts", () => {
    const result = runMissingScriptsRule(`
      import { Scripts } from "@tanstack/react-router";

      const AppScripts = () => <Scripts />;
      const AppShell = () => <AppScripts />;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <AppShell />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps Scripts aliases scoped to their bindings", () => {
    const result = runMissingScriptsRule(`
      import { Scripts } from "@tanstack/react-router";

      const AppScripts = () => <main>Home</main>;

      const NestedScope = () => {
        const AppScripts = Scripts;
        return <AppScripts />;
      };

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <AppScripts />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept unrelated custom body children as proof", () => {
    const result = runMissingScriptsRule(`
      const AppShell = () => <main>Home</main>;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <body>
              <AppShell />
            </body>
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the root route does not own the document body", () => {
    const result = runMissingScriptsRule(`
      export const Route = createRootRoute({
        component: () => <Outlet />,
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet outside TanStack root route files", () => {
    const result = runMissingScriptsRule(
      `
        export const Page = () => (
          <html>
            <body />
          </html>
        );
      `,
      "src/routes/index.tsx",
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
