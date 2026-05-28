import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartMissingHeadContent } from "./tanstack-start-missing-head-content.js";

const ROOT_ROUTE_FILENAME = "src/routes/__root.tsx";

const runMissingHeadContentRule = (code: string, filename = ROOT_ROUTE_FILENAME) =>
  runRule(tanstackStartMissingHeadContent, code, { filename });

const runRootRoute = (code: string) => runMissingHeadContentRule(code, ROOT_ROUTE_FILENAME);

describe("tanstack-start/missing-head-content", () => {
  it("flags root route document heads without HeadContent", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head />
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags root route document heads that only contain intrinsic elements", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <title>Example</title>
              <meta name="description" content="Example" />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows direct HeadContent usage", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <HeadContent />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows local HeadContent wrapper components", () => {
    const result = runRootRoute(`
      const AppHead = () => <HeadContent />;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <AppHead />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows aliased HeadContent imports from TanStack Router", () => {
    const result = runRootRoute(`
      import { HeadContent as RouterHeadContent } from "@tanstack/react-router";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <RouterHeadContent />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows aliased HeadContent imports declared after the route", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <RouterHeadContent />
            </head>
            <body />
          </html>
        ),
      });

      import { HeadContent as RouterHeadContent } from "@tanstack/react-router";
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows aliased HeadContent imports from project barrels", () => {
    const result = runRootRoute(`
      import { HeadContent as RouterHeadContent } from "@/router-components";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <RouterHeadContent />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows project barrel HeadContent imports declared after the route", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <RouterHeadContent />
            </head>
            <body />
          </html>
        ),
      });

      import { HeadContent as RouterHeadContent } from "@/router-components";
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows namespace HeadContent imports from TanStack Router", () => {
    const result = runRootRoute(`
      import * as TanStackRouter from "@tanstack/react-router";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <TanStackRouter.HeadContent />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows namespace HeadContent imports declared after the route", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <TanStackRouter.HeadContent />
            </head>
            <body />
          </html>
        ),
      });

      import * as TanStackRouter from "@tanstack/react-router";
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows component aliases assigned from HeadContent", () => {
    const result = runRootRoute(`
      const AppHead = HeadContent;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <AppHead />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows top-level component aliases declared after the route", () => {
    const result = runRootRoute(`
      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <AppHead />
            </head>
            <body />
          </html>
        ),
      });

      const AppHead = HeadContent;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows component aliases assigned from TanStack Router namespace HeadContent", () => {
    const result = runRootRoute(`
      import * as TanStackRouter from "@tanstack/react-router";

      const AppHead = TanStackRouter.HeadContent;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <AppHead />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows namespace aliases assigned from TanStack Router namespace imports", () => {
    const result = runRootRoute(`
      import * as TanStackRouter from "@tanstack/react-router";

      const Router = TanStackRouter;

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <Router.HeadContent />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows custom head components from wrapper libraries", () => {
    const result = runRootRoute(`
      import { DocumentHead } from "@acme/tanstack-layout";

      export const Route = createRootRoute({
        component: () => (
          <html>
            <head>
              <DocumentHead />
            </head>
            <body />
          </html>
        ),
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag root routes that delegate the document shell", () => {
    const result = runRootRoute(`
      import { RootDocument } from "../components/root-document";

      export const Route = createRootRoute({
        shellComponent: RootDocument,
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag same-file document shells used through shellComponent", () => {
    const result = runRootRoute(`
      const RootDocument = ({ children }) => (
        <html>
          <head>
            <HeadContent />
          </head>
          <body>{children}</body>
        </html>
      );

      export const Route = createRootRoute({
        shellComponent: RootDocument,
      });
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag non-root route files", () => {
    const result = runMissingHeadContentRule(
      `
        export const Route = createFileRoute("/about")({
          component: () => (
            <html>
              <head />
              <body />
            </html>
          ),
        });
      `,
      "src/routes/about.tsx",
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
