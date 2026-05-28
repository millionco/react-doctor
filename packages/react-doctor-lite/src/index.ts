import { runDiagnostics } from "./runner/run-diagnostics.js";
import type { DiagnoseInput, DiagnoseResult } from "./types.js";

// The single public entry point.
//
// Disk mode — walk a project on disk:
//   await diagnose({ cwd: "/path/to/app" })
//
// Programmatic mode — no `package.json`, no source files on disk (evals):
//   await diagnose({
//     dependencies: { dependencies: { react: "19.0.0" } },
//     sources: [{ filePath: "App.tsx", code: "..." }],
//   })
export const diagnose = async (input: DiagnoseInput = {}): Promise<DiagnoseResult> =>
  runDiagnostics(input);

export {
  buildDependencyGraphFromDisk,
  buildDependencyGraphFromManifest,
} from "./dependency-graph/build-dependency-graph.js";
export { createDependencyGraph } from "./dependency-graph/create-dependency-graph.js";
export { buildCapabilities } from "./capabilities/build-capabilities.js";
export { loadRules } from "./rules/load-rules.js";
export { lintSource } from "./runner/lint-source.js";

export type {
  ConcurrencyOptions,
  DependencyGraph,
  DependencyGraphSummary,
  DependencyManifest,
  DiagnoseInput,
  DiagnoseResult,
  DiagnosticSeverity,
  Framework,
  LiteDiagnostic,
  LiteSource,
  LoadedRule,
  PackageNode,
  RuleSelection,
  SeverityOverride,
} from "./types.js";
