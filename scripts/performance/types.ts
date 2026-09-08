export interface BenchmarkCliOptions {
  directories: string[];
  samples: number;
  warmups: number;
  workerCounts: Array<number | "auto">;
  modes: BenchmarkMode[];
  cacheCohorts: BenchmarkCacheCohort[];
  outputDirectory: string;
  comparePath: string | null;
  cliPath: string;
  profile: boolean;
  heapProfile: boolean;
  ruleTimings: boolean;
  corpus?: string[];
  strict?: boolean;
}

export interface CorpusTarget {
  readonly name: string;
  readonly repository: string;
  readonly sha: string;
  readonly subdirectory?: string;
  readonly fileCount?: number;
}

export interface CreateStressProjectInput {
  readonly directory: string;
  readonly fileCount: number;
  readonly componentsPerFileCount: number;
}

export interface StressProjectMetadata {
  readonly directory: string;
  readonly generatedSourceFileCount: number;
  readonly componentCount: number;
}

export interface PerformanceCommandOptions {
  readonly samples: number;
  readonly warmups: number;
  readonly workers: string;
  readonly mode: string;
  readonly cache: string;
  readonly out: string;
  readonly cli: string;
  readonly compare?: string;
  readonly profile: boolean;
  readonly heapProfile: boolean;
  readonly ruleTimings: boolean;
  readonly corpus?: string;
  readonly strict?: boolean;
}

export interface StressPerformanceCommandOptions extends PerformanceCommandOptions {
  readonly files: number;
  readonly componentsPerFile: number;
  readonly project: string;
}

export interface BenchmarkTargetInput {
  readonly directory: string;
  readonly label: string;
}

export interface BenchmarkTargetMetadata {
  targetId: string;
  directory: string;
  label: string;
  gitSha: string | null;
  isGitDirty: boolean | null;
  sourceFileCount: number;
  sourceByteCount: number;
  sourceFingerprint: string;
}

export interface HostMetadata {
  platform: NodeJS.Platform;
  architecture: string;
  nodeVersion: string;
  v8Version: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
  hostname: string;
}

export interface ValidatedBenchmarkReport {
  elapsedMilliseconds: number;
  diagnosticCount: number;
  diagnosticHash: string;
  scannedFileCount: number;
}

export interface ReadBenchmarkReportInput {
  reportPath: string;
  targetDirectory: string;
}

export interface ProcessResourceUsage {
  userSeconds: number | null;
  systemSeconds: number | null;
  maximumResidentSetBytes: number | null;
}

export interface BenchmarkSample {
  index: number;
  wallMilliseconds: number;
  cliElapsedMilliseconds: number;
  userSeconds: number | null;
  systemSeconds: number | null;
  maximumResidentSetBytes: number | null;
  diagnosticCount: number;
  diagnosticHash: string;
  scannedFileCount: number;
  timeline?: ScanTimeline | null;
}

export interface OxlintSpawnChildRecord {
  pid: number | null;
  startedAt: number;
  endedAt: number;
  fileCount: number;
  configPath: string | null;
  exitCode: number | null;
  signal: string | null;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutPreview: string;
}

export interface OxlintSpawnParentRecord {
  pid: number;
  exitedAt: number;
  userMicroseconds: number;
  systemMicroseconds: number;
}

export interface OxlintSpawnLog {
  children: OxlintSpawnChildRecord[];
  parent: OxlintSpawnParentRecord | null;
}

export interface SummarizeScanTimelineInput {
  readonly spawnLog: OxlintSpawnLog;
  readonly scanStartedAt: number;
  readonly scanEndedAt: number;
}

export interface ScanTimeline {
  wallMilliseconds: number;
  childProcessCount: number;
  failedChildProcessCount: number;
  configCount: number;
  childFileCount: number;
  childDurationSumMilliseconds: number;
  childDurationMedianMilliseconds: number;
  childDurationMaximumMilliseconds: number;
  childSpanMilliseconds: number;
  averageConcurrency: number;
  peakConcurrency: number;
  headMilliseconds: number;
  tailMilliseconds: number;
  parentUserSeconds: number | null;
  parentSystemSeconds: number | null;
}

export interface RuleTimingRow {
  rule: string;
  totalMilliseconds: number;
  percentOfTotal: number;
  calls: number;
  createMilliseconds: number;
  topSelector: string;
}

export interface SelectorTimingRow {
  selector: string;
  totalMilliseconds: number;
  percentOfTotal: number;
  calls: number;
  ruleCount: number;
  topRule: string;
}

export interface RuleTimingSummary {
  processCount: number;
  totalMilliseconds: number;
  createMilliseconds: number;
  rules: RuleTimingRow[];
  selectors: SelectorTimingRow[];
}

export interface CpuProfileSourceSummary {
  source: string;
  selfMicroseconds: number;
  selfPercent: number;
  frameCount: number;
}

export interface CpuProfileSummary {
  processCount: number;
  sampledMicroseconds: number;
  categories: CpuProfileSourceSummary[];
  functions: CpuProfileFrameSummary[];
  sources: CpuProfileSourceSummary[];
}

export interface DistributionSummary {
  minimum: number;
  median: number;
  maximum: number;
  medianAbsoluteDeviation: number;
}

export interface BenchmarkSeries {
  target: BenchmarkTargetMetadata;
  mode: BenchmarkMode;
  cacheCohort: BenchmarkCacheCohort;
  workerCount: number | "auto";
  samples: BenchmarkSample[];
  wallMilliseconds: DistributionSummary;
  cliElapsedMilliseconds: DistributionSummary;
  maximumResidentSetBytes: DistributionSummary | null;
  filesPerSecond: number;
  mebibytesPerSecond: number;
  diagnosticHash: string;
  userSeconds?: DistributionSummary | null;
  systemSeconds?: DistributionSummary | null;
  timeline?: ScanTimeline | null;
  ruleTimings?: RuleTimingSummary | null;
  cpuProfile?: CpuProfileSummary | null;
}

export interface BenchmarkComparison {
  key: string;
  baselineMedianMilliseconds: number;
  currentMedianMilliseconds: number;
  deltaMilliseconds: number;
  deltaRatio: number;
  speedupRatio: number;
  diagnosticsMatch: boolean;
  classification: "improved" | "stable" | "regressed" | "diagnostics-mismatch";
}

export interface BuildBenchmarkComparisonsOptions {
  readonly allowDiagnosticMismatch?: boolean;
}

export interface BenchmarkComparisonSeries {
  target: {
    targetId: string;
    directory: string;
    label?: string;
    sourceFileCount: number;
    sourceByteCount: number;
    sourceFingerprint: string;
  };
  mode: BenchmarkMode;
  cacheCohort: BenchmarkCacheCohort;
  workerCount: number | "auto";
  wallMilliseconds: {
    median: number;
  };
  diagnosticHash: string;
}

export interface PerformanceResult {
  schemaVersion: 1;
  generatedAt: string;
  reactDoctorGitSha: string | null;
  reactDoctorIsDirty: boolean | null;
  host: HostMetadata;
  options: Omit<BenchmarkCliOptions, "directories" | "comparePath">;
  series: BenchmarkSeries[];
  comparisons: BenchmarkComparison[];
}

export interface V8ProfileCallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface CpuProfileNode {
  id: number;
  callFrame: V8ProfileCallFrame;
  children?: number[];
}

export interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

export interface CpuProfileFrameSummary {
  functionName: string;
  url: string;
  lineNumber: number;
  selfMicroseconds: number;
  totalMicroseconds: number;
  selfPercent: number;
  totalPercent: number;
}

export interface CpuProfileProcessSummary {
  file: string;
  role: string;
  sampledMicroseconds: number;
  topFrames: CpuProfileFrameSummary[];
}

export interface CpuProfileAnalysis {
  generatedAt: string;
  profileDirectory: string;
  sampledMicroseconds: number;
  processes: CpuProfileProcessSummary[];
  aggregateTopFrames: CpuProfileFrameSummary[];
}

export interface HeapProfileNode {
  callFrame: V8ProfileCallFrame;
  selfSize: number;
  id: number;
  children: HeapProfileNode[];
}

export interface HeapProfile {
  head: HeapProfileNode;
}

export interface HeapProfileFrameSummary {
  functionName: string;
  url: string;
  lineNumber: number;
  selfBytes: number;
  totalBytes: number;
  selfPercent: number;
  totalPercent: number;
}

export interface HeapProfileProcessSummary {
  file: string;
  role: string;
  sampledBytes: number;
  topFrames: HeapProfileFrameSummary[];
}

export interface HeapProfileAnalysis {
  generatedAt: string;
  profileDirectory: string;
  sampledBytes: number;
  processes: HeapProfileProcessSummary[];
  aggregateTopFrames: HeapProfileFrameSummary[];
}

export interface OxlintRuleTiming {
  rule: string;
  timeMilliseconds: number;
  relativePercent: number;
  calls: number;
  source: string;
}

export interface CapturedRulePerformanceTiming {
  rule: string;
  selector: string;
  timeNanoseconds: string;
  calls: number;
}

export interface OxlintTimingProcessSummary {
  file: string;
  totalTimeMilliseconds: number;
  rules: OxlintRuleTiming[];
}

export interface OxlintTimingAnalysis {
  generatedAt: string;
  profileDirectory: string;
  totalTimeMilliseconds: number;
  processes: OxlintTimingProcessSummary[];
  aggregateRules: OxlintRuleTiming[];
}

export type BenchmarkMode = "lint" | "full";
export type BenchmarkCacheCohort = "no-cache" | "cold" | "hot";
