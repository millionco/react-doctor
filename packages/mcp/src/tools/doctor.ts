import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { diagnose, type DiagnoseResult } from "@react-doctor/api";
import { z } from "zod";
import { MAX_INLINE_DIAGNOSTICS } from "../constants.js";
import { jsonResult, runTool } from "../utils/tool-result.js";

const summarizeScan = (result: DiagnoseResult) => {
  const errorCount = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const affectedFiles = new Set(result.diagnostics.map((diagnostic) => diagnostic.filePath));
  return {
    score: result.score?.score ?? null,
    scoreLabel: result.score?.label ?? null,
    totalDiagnostics: result.diagnostics.length,
    errorCount,
    warningCount: result.diagnostics.length - errorCount,
    affectedFileCount: affectedFiles.size,
    skippedChecks: result.skippedChecks,
    truncated: result.diagnostics.length > MAX_INLINE_DIAGNOSTICS,
    diagnostics: result.diagnostics.slice(0, MAX_INLINE_DIAGNOSTICS).map((diagnostic) => ({
      rule: `${diagnostic.plugin}/${diagnostic.rule}`,
      severity: diagnostic.severity,
      category: diagnostic.category,
      title: diagnostic.title ?? null,
      message: diagnostic.message,
      file: diagnostic.filePath,
      line: diagnostic.line,
      column: diagnostic.column,
    })),
  };
};

export const registerDoctorTools = (server: McpServer): void => {
  server.registerTool(
    "doctor_scan",
    {
      title: "Scan React project health",
      description:
        "Run React Doctor's static analysis on a project directory and return a 0–100 health score plus diagnostics across lint, accessibility, performance, security, and architecture. Use after writing or before committing React / React Native code, or to triage a codebase.",
      inputSchema: {
        directory: z
          .string()
          .optional()
          .describe("Project directory to scan (default: the server's working directory)"),
        deadCode: z
          .boolean()
          .optional()
          .describe(
            "Run dead-code analysis — unused files/exports/dependencies, circular imports (default true)",
          ),
        warnings: z
          .boolean()
          .optional()
          .describe("Include warning-severity diagnostics (default true)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const result = await diagnose(args.directory ?? process.cwd(), {
          deadCode: args.deadCode,
          warnings: args.warnings,
        });
        return jsonResult(summarizeScan(result));
      }),
  );
};
