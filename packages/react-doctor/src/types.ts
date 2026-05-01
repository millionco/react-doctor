export type FailOnLevel = "error" | "warning" | "none";

export type Framework =
  | "nextjs"
  | "vite"
  | "cra"
  | "remix"
  | "gatsby"
  | "expo"
  | "react-native"
  | "tanstack-start"
  | "unknown";

export interface ProjectInfo {
  rootDirectory: string;
  projectName: string;
  reactVersion: string | null;
  framework: Framework;
  hasTypeScript: boolean;
  hasReactCompiler: boolean;
  hasTanStackQuery: boolean;
  sourceFileCount: number;
}

interface OxlintSpan {
  offset: number;
  length: number;
  line: number;
  column: number;
}

interface OxlintLabel {
  label: string;
  span: OxlintSpan;
}

interface OxlintDiagnostic {
  message: string;
  code: string;
  severity: "warning" | "error";
  causes: string[];
  url: string;
  help: string;
  filename: string;
  labels: OxlintLabel[];
  related: unknown[];
}

export interface OxlintOutput {
  diagnostics: OxlintDiagnostic[];
  number_of_files: number;
  number_of_rules: number;
}

export interface Diagnostic {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
}

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
  catalog?: unknown;
  catalogs?: unknown;
}

export interface DependencyInfo {
  reactVersion: string | null;
  framework: Framework;
}

interface KnipIssue {
  filePath: string;
  symbol: string;
  type: string;
}

export interface KnipIssueRecords {
  [workspace: string]: {
    [filePath: string]: KnipIssue;
  };
}

export interface ScoreResult {
  score: number;
  label: string;
}

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  includePaths?: string[];
  /**
   * Per-call override for `ReactDoctorConfig.respectInlineDisables`.
   * See that field's docs for the full contract.
   */
  respectInlineDisables?: boolean;
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export interface ScanResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  skippedChecks: string[];
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export interface ScanOptions {
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  scoreOnly?: boolean;
  offline?: boolean;
  silent?: boolean;
  includePaths?: string[];
  configOverride?: ReactDoctorConfig | null;
  respectInlineDisables?: boolean;
}

export interface DiffInfo {
  currentBranch: string;
  baseBranch: string;
  changedFiles: string[];
  isCurrentChanges?: boolean;
}

export interface HandleErrorOptions {
  shouldExit: boolean;
}

export interface WorkspacePackage {
  name: string;
  directory: string;
}

export interface PromptMultiselectChoiceState {
  selected?: boolean;
  disabled?: boolean;
}

export interface PromptMultiselectContext {
  maxChoices?: number;
  cursor: number;
  value: PromptMultiselectChoiceState[];
  bell: () => void;
  render: () => void;
}

export interface KnipResults {
  issues: {
    files: KnipIssueRecords | Set<string> | string[];
    dependencies: KnipIssueRecords;
    devDependencies: KnipIssueRecords;
    unlisted: KnipIssueRecords;
    exports: KnipIssueRecords;
    types: KnipIssueRecords;
    duplicates: KnipIssueRecords;
  };
  counters: Record<string, number>;
}

export interface CleanedDiagnostic {
  message: string;
  help: string;
}

interface ReactDoctorIgnoreConfig {
  rules?: string[];
  files?: string[];
}

export interface ReactDoctorConfig {
  ignore?: ReactDoctorIgnoreConfig;
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  diff?: boolean | string;
  failOn?: FailOnLevel;
  customRulesOnly?: boolean;
  share?: boolean;
  textComponents?: string[];
  /**
   * Whether to respect inline `// eslint-disable*` / `// oxlint-disable*`
   * comments in source files. Default: `true`.
   *
   * File-level ignores (`.gitignore`, `.eslintignore`, `.oxlintignore`,
   * `.prettierignore`, `.gitattributes` `linguist-vendored` /
   * `linguist-generated`) are ALWAYS honored regardless of this option
   * — they typically point at vendored or generated code that
   * genuinely shouldn't be linted at all.
   *
   * Set to `false` for "audit mode": every inline suppression is
   * neutralized so react-doctor reports every diagnostic regardless
   * of historical hide-comments.
   */
  respectInlineDisables?: boolean;
}

export type JsonReportMode = "full" | "diff" | "staged";

export interface JsonReportDiffInfo {
  baseBranch: string;
  currentBranch: string;
  changedFileCount: number;
  isCurrentChanges: boolean;
}

export interface JsonReportProjectEntry {
  directory: string;
  project: ProjectInfo;
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  skippedChecks: string[];
  elapsedMilliseconds: number;
}

export interface JsonReportSummary {
  errorCount: number;
  warningCount: number;
  affectedFileCount: number;
  totalDiagnosticCount: number;
  score: number | null;
  scoreLabel: string | null;
}

export interface JsonReportError {
  message: string;
  name: string;
  chain: string[];
}

export interface JsonReport {
  schemaVersion: 1;
  version: string;
  ok: boolean;
  directory: string;
  mode: JsonReportMode;
  diff: JsonReportDiffInfo | null;
  projects: JsonReportProjectEntry[];
  /**
   * Flattened across `projects[].diagnostics` for convenience. Equivalent to
   * `projects.flatMap((project) => project.diagnostics)`.
   */
  diagnostics: Diagnostic[];
  summary: JsonReportSummary;
  elapsedMilliseconds: number;
  error: JsonReportError | null;
}
