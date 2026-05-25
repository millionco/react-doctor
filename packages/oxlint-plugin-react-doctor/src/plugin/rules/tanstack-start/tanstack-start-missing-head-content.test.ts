import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import type { ReportDescriptor } from "../../utils/report-descriptor.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { tanstackStartMissingHeadContent } from "./tanstack-start-missing-head-content.js";

const ROOT_ROUTE_FILENAME = "src/routes/__root.tsx";

interface RuleDiagnostic {
  message: string;
  nodeType: string;
}

interface RunMissingHeadContentRuleResult {
  diagnostics: RuleDiagnostic[];
  parseErrors: ReadonlyArray<{ message: string }>;
}

const dispatchTreeWalkWithProgramExit = (root: EsTreeNode, visitors: RuleVisitors): void => {
  const visit = (node: EsTreeNode): void => {
    const handler = visitors[node.type];
    if (typeof handler === "function") handler(node);

    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item)) visit(item);
        }
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };

  visit(root);
  const programExitHandler = visitors["Program:exit"];
  if (typeof programExitHandler === "function") programExitHandler(root);
};

const runMissingHeadContentRule = (
  code: string,
  filename = ROOT_ROUTE_FILENAME,
): RunMissingHeadContentRuleResult => {
  const parsed = parseFixture(code, { filename });
  attachParentReferences(parsed.program);

  const diagnostics: RuleDiagnostic[] = [];
  const context: RuleContext = {
    report: (descriptor: ReportDescriptor) => {
      diagnostics.push({
        message: descriptor.message,
        nodeType: descriptor.node.type,
      });
    },
    getFilename: () => filename,
    scopes: analyzeScopes(parsed.program),
    cfg: analyzeControlFlow(parsed.program),
  };

  const visitors = tanstackStartMissingHeadContent.create(context);
  dispatchTreeWalkWithProgramExit(parsed.program, visitors);

  return {
    diagnostics,
    parseErrors: parsed.errors,
  };
};

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
