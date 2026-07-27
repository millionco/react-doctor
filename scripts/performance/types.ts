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
}

export interface StressPerformanceCommandOptions extends PerformanceCommandOptions {
  readonly files: number;
  readonly componentsPerFile: number;
  readonly project: string;
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
}

export interface BenchmarkComparison {
  key: string;
  baselineMedianMilliseconds: number;
  currentMedianMilliseconds: number;
  deltaMilliseconds: number;
  deltaRatio: number;
  classification: "improved" | "stable" | "regressed";
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

export interface OxlintOverheadOptions {
  readonly samples: number;
  readonly warmups: number;
  readonly outputPrefix: string;
}

export interface OxlintJsonSummary {
  readonly diagnosticCount: number;
  readonly fileCount: number;
  readonly ruleCount: number;
}

export interface OxlintOverheadCommandOptions {
  readonly samples: number;
  readonly warmups: number;
  readonly out: string;
}

export interface OxlintOverheadMeasurement {
  readonly id: string;
  readonly label: string;
  readonly method: string;
  readonly classification: "direct";
  readonly milliseconds: DistributionSummary;
}

export interface OxlintOverheadResidual {
  readonly id: string;
  readonly label: string;
  readonly calculation: string;
  readonly classification: "inferred";
  readonly medianMilliseconds: number;
}

export interface OxlintOverheadWorkloadDefinition {
  readonly id: string;
  readonly label: string;
  readonly sourceFileCount: number;
  readonly sourceDirectoryCount: number;
  readonly callExpressionsPerFile: number;
}

export interface OxlintOverheadWorkloadMetadata extends OxlintOverheadWorkloadDefinition {
  readonly sourceByteCount: number;
  readonly totalCallExpressionCount: number;
}

export interface CreatedOxlintOverheadWorkload {
  readonly metadata: OxlintOverheadWorkloadMetadata;
  readonly sourceDirectory: string;
}

export interface OxlintOverheadShare {
  readonly id: string;
  readonly label: string;
  readonly calculation: string;
  readonly classification: "inferred";
  readonly numeratorMilliseconds: number;
  readonly denominatorMilliseconds: number;
  readonly percentage: number;
}

export interface OxlintOverheadWorkloadResult extends OxlintOverheadWorkloadMetadata {
  readonly measurements: ReadonlyArray<OxlintOverheadMeasurement>;
  readonly residuals: ReadonlyArray<OxlintOverheadResidual>;
  readonly shares: ReadonlyArray<OxlintOverheadShare>;
}

export interface OxlintOverheadResult {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly host: {
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly nodeVersion: string;
    readonly v8Version: string;
    readonly cpuModel: string;
    readonly cpuCount: number;
  };
  readonly toolchain: {
    readonly oxlintVersion: string;
    readonly pluginPath: string;
    readonly representativeRule: string;
    readonly representativeSourceBytes: number;
    readonly representativeCallExpressionCount: number;
    readonly oxlintThreadCount: number;
  };
  readonly options: OxlintOverheadOptions;
  readonly measurements: ReadonlyArray<OxlintOverheadMeasurement>;
  readonly residuals: ReadonlyArray<OxlintOverheadResidual>;
  readonly workloads: ReadonlyArray<OxlintOverheadWorkloadResult>;
  readonly limitations: ReadonlyArray<string>;
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

export type BenchmarkMode = "lint" | "full";
export type BenchmarkCacheCohort = "no-cache" | "cold" | "hot";
