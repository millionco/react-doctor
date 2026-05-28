import type { EsTreeNode, RuleVisitors } from "oxlint-plugin-react-doctor";

export type Framework =
  | "nextjs"
  | "vite"
  | "cra"
  | "remix"
  | "gatsby"
  | "expo"
  | "react-native"
  | "tanstack-start"
  | "preact"
  | "unknown";

export type DiagnosticSeverity = "error" | "warning";

export type SeverityOverride = "error" | "warning" | "off";

// A dependency manifest is the subset of a `package.json` the engine cares
// about. Disk mode reads these off the filesystem; programmatic mode (evals)
// passes one directly so no fake `package.json` ever has to be inflated.
export interface DependencyManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

// One resolved node in the dependency graph — a single package manifest with
// its dependency sections flattened into a single concrete-version lookup.
export interface PackageNode {
  name: string;
  directory: string;
  isRoot: boolean;
  dependencies: ReadonlyMap<string, string>;
}

// The composable replacement for the pile of `hasTanStackQuery` /
// `hasPreact` / `parseReactMajor` booleans. Rules (and capability
// derivation) query it instead of reading bespoke `ProjectInfo` fields.
export interface DependencyGraph {
  readonly packages: ReadonlyArray<PackageNode>;
  readonly framework: Framework;
  // `hasDependency("react")` or `hasDependency("react@>=19")` or
  // `hasDependency("react", ">=19")`. Range is matched against the lowest
  // installed major across the whole graph (monorepo-safe).
  hasDependency(specifier: string, range?: string): boolean;
  hasAnyDependency(names: ReadonlyArray<string>): boolean;
  getVersion(name: string): string | null;
  getMajor(name: string): number | null;
}

export interface DependencyGraphSummary {
  framework: Framework;
  packageCount: number;
  reactVersion: string | null;
  reactMajor: number | null;
}

export interface LiteSource {
  filePath: string;
  code: string;
}

export interface LiteDiagnostic {
  filePath: string;
  rule: string;
  ruleKey: string;
  severity: DiagnosticSeverity;
  category: string;
  message: string;
  recommendation?: string;
  line: number;
  column: number;
}

export interface ConcurrencyOptions {
  // Number of worker threads. Defaults to `os.availableParallelism()`.
  poolSize?: number;
  // Files handed to a single worker task. Larger batches amortize the
  // per-task message overhead; smaller batches balance load more evenly.
  batchSize?: number;
  // Force the synchronous in-process path even when `poolSize > 1`. Used by
  // tests and tiny programmatic inputs where spawning threads is wasteful.
  disableWorkers?: boolean;
}

export interface RuleSelection {
  // When present, only these bare rule ids run (still capability-gated).
  only?: ReadonlyArray<string>;
  disable?: ReadonlyArray<string>;
  severity?: Record<string, SeverityOverride>;
  // Behavioral tags to drop wholesale (e.g. "test-noise", "design").
  ignoreTags?: ReadonlyArray<string>;
  // Include rules shipped with `defaultEnabled: false`.
  includeDefaultDisabled?: boolean;
}

export interface DiagnoseInput {
  // Root directory for filesystem operations and dependency-graph discovery.
  // Optional in pure in-memory mode.
  cwd?: string;
  // Explicit in-memory sources. When provided, the filesystem is never walked
  // for source files.
  sources?: ReadonlyArray<LiteSource>;
  // Explicit dependency manifest. When provided, no `package.json` is read.
  dependencies?: DependencyManifest;
  concurrency?: ConcurrencyOptions;
  rules?: RuleSelection;
  // Forwarded to oxlint-plugin-react-doctor rules via `context.settings`.
  settings?: Record<string, unknown>;
}

export interface DiagnoseResult {
  diagnostics: LiteDiagnostic[];
  graph: DependencyGraphSummary;
  capabilities: string[];
  enabledRuleCount: number;
  scannedFileCount: number;
  elapsedMilliseconds: number;
  ranInWorkerPool: boolean;
}

// Minimal `BaseRuleContext` the oxlint-plugin-react-doctor host rules accept.
export interface LiteRuleContext {
  report: (descriptor: { node: EsTreeNode; message: string }) => void;
  getFilename: () => string;
  settings: Readonly<Record<string, unknown>>;
}

// A rule resolved from the plugin registry, capability-gated and ready to run.
export interface LoadedRule {
  id: string;
  key: string;
  severity: DiagnosticSeverity;
  category: string;
  recommendation?: string;
  create: (context: LiteRuleContext) => RuleVisitors;
}

// The serializable payload a worker thread needs to lint a batch of files.
export interface WorkerTask {
  filePaths: ReadonlyArray<string>;
  enabledRuleIds: ReadonlyArray<string>;
  severityById: Record<string, DiagnosticSeverity>;
  settings: Record<string, unknown>;
}
