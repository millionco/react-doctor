import type {
  ChangedFileLineRanges,
  DiagnosticSurface,
  InspectOptions,
  Progress,
  Reporter,
} from "@react-doctor/core";
import type * as Layer from "effect/Layer";

export interface InspectUiLayers {
  readonly reporter: Layer.Layer<Reporter>;
  readonly progress?: Layer.Layer<Progress>;
}

export interface ReactDoctorInspectOptions extends InspectOptions {
  precomputedSourceFileCount?: number;
  categoryFilters?: string[];
  includedTags?: ReadonlySet<string>;
  includeTagDefaults?: boolean;
  scoreDisabledMessage?: string;
  deadlineEpochMs?: number;
  excludedProjectDirectories?: ReadonlyArray<string>;
  retainExcludedProjectDeadCodeDiagnostics?: boolean;
  uiLayers?: InspectUiLayers;
}

export interface ResolvedInspectOptions {
  lint: boolean;
  deadCode: boolean;
  supplyChain: boolean;
  verbose: boolean;
  outputDirectory: string | null;
  scoreOnly: boolean;
  noScore: boolean;
  isCi: boolean;
  isCiOrCodingAgentEnvironment: boolean;
  isNonInteractiveEnvironment: boolean;
  silent: boolean;
  includePaths: string[];
  customRulesOnly: boolean;
  share: boolean;
  respectInlineDisables: boolean;
  warnings: boolean;
  categoryFilters: ReadonlySet<string>;
  adoptExistingLintConfig: boolean;
  ignoredTags: ReadonlySet<string>;
  includedTags: ReadonlySet<string>;
  includeTagDefaults: boolean;
  scoreDisabledMessage: string | undefined;
  outputSurface: DiagnosticSurface;
  suppressRendering: boolean;
  uiLayers: InspectUiLayers | null;
  concurrentScan: boolean;
  concurrency: number | undefined;
  maxDurationMs: number | null;
  baseline: {
    ref: string;
    baseFiles?: ReadonlyArray<string>;
    headFiles?: ReadonlyArray<string>;
  } | null;
  changedLineRanges: ReadonlyArray<ChangedFileLineRanges> | null;
  supplyChainManifestChanged: boolean;
  excludedProjectDirectories: ReadonlyArray<string>;
  retainExcludedProjectDeadCodeDiagnostics: boolean;
  precomputedSourceFileCount: number | undefined;
}
