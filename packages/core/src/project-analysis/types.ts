import type { ProjectAnalysisError } from "./errors.js";

export type {
  ProjectAnalysisError,
  ProjectAnalysisErrorCode,
  ProjectAnalysisErrorModule,
  ProjectAnalysisErrorSeverity,
} from "./errors.js";

export interface SourceFile {
  index: number;
  path: string;
}

export interface ImportBinding {
  name: string;
  alias: string | undefined;
  isNamespace: boolean;
  isDefault: boolean;
  isTypeOnly: boolean;
  isRedundantAlias?: boolean;
}

export interface ImportReference {
  specifier: string;
  importedNames: ImportBinding[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  isSideEffect: boolean;
  isGlob?: boolean;
  globBaseDirectory?: string;
  globFilterPattern?: string;
  globFilterFlags?: string;
  line: number;
  column: number;
}

export interface ExportReference {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
  isReExport: boolean;
  isSynthetic: boolean;
  reExportSource: string | undefined;
  reExportOriginalName: string | undefined;
  isNamespaceReExport: boolean;
  line: number;
  column: number;
  defaultExportLocalName?: string;
  isRedundantAlias?: boolean;
}

export interface MemberAccess {
  objectName: string;
  memberName: string;
}

export interface SourceModuleAnalysis {
  imports: ImportReference[];
  exports: ExportReference[];
  memberAccesses: MemberAccess[];
  wholeObjectUses: string[];
  localIdentifierReferences: string[];
  topLevelImportReferences: string[];
  referencedFilenames: string[];
  hasUnknownDynamicModuleLoad: boolean;
}

export interface SourceModule extends SourceModuleAnalysis {
  fileId: SourceFile;
  parseErrors: ProjectAnalysisError[];
  isEntryPoint: boolean;
  isExternallyConsumed: boolean;
  isTestEntry: boolean;
  isReachable: boolean;
  isDeclarationFile: boolean;
  isConfigFile: boolean;
  isGitIgnored: boolean;
  isAnalysisExcluded: boolean;
  isAuthoritativeEntryPoint: boolean;
  isExplicitEntryPoint: boolean;
  isPackageGraphComplete: boolean;
  hasPackageDynamicLoaderUncertainty: boolean;
}

export interface ReExportMapping {
  exportedName: string;
  originalName: string;
}

export interface LinkedSymbol {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
  isNamespace: boolean;
  isDefault: boolean;
}

export interface Edge {
  source: number;
  target: number;
  importedSymbols: LinkedSymbol[];
  isReExportEdge: boolean;
  isDynamic: boolean;
  isSideEffect: boolean;
  isTypeOnly: boolean;
  reExportedNames: string[];
  reExportMappings: ReExportMapping[];
}

export interface DependencyGraph {
  modules: SourceModule[];
  edges: Edge[];
  reverseEdges: Map<number, number[]>;
  fileIdMap: Map<string, number>;
}

export interface UnusedFile {
  path: string;
}

export interface UnusedExport {
  path: string;
  name: string;
  line: number;
  column: number;
  isTypeOnly: boolean;
}

export interface UnusedDependency {
  name: string;
  isDevDependency: boolean;
  reason: string;
}

export type SkippedDependencyReason =
  | "allowlisted-name"
  | "ambiguous-binary"
  | "provides-binary"
  | "incomplete-peer-metadata";

export interface SkippedDependency {
  name: string;
  isDevDependency: boolean;
  reasons: SkippedDependencyReason[];
}

export interface CircularDependency {
  files: string[];
}

export interface ResolvedEntries {
  productionEntries: string[];
  authoritativeProductionEntries: string[];
  explicitProductionEntries: string[];
  testEntries: string[];
  alwaysUsedFiles: string[];
  externallyConsumedFiles: string[];
  analysisExcludedFiles: string[];
  viteProjectScopes?: ViteProjectScope[];
}

export interface ViteProjectScope {
  configPath: string;
  configDirectory: string;
  rootDirectory: string;
  entryPaths: string[];
}

export interface ProjectAnalysisConfig {
  rootDir: string;
  entryPatterns: string[];
  ignorePatterns: string[];
  includeExtensions: string[];
  tsConfigPath: string | undefined;
  paths: Record<string, string[]> | undefined;
  reportTypes: boolean;
  includeEntryExports: boolean;
  hasExplicitEntryPatterns: boolean;
}

export interface PackageLockPackageMetadata {
  version?: string;
  bin?: string | Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface PeerSatisfiedPackageCollection {
  peerSatisfiedPackageNames: Set<string>;
  isPeerMetadataComplete: boolean;
}
