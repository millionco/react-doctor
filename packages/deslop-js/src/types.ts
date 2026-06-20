import type { DeslopError } from "./errors.js";

export type {
  DeslopError,
  DeslopErrorCode,
  DeslopErrorModule,
  DeslopErrorSeverity,
} from "./errors.js";

export interface SourceFile {
  index: number;
  path: string;
}

export interface ImportReference {
  specifier: string;
  importedNames: ImportBinding[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  isSideEffect: boolean;
  isGlob?: boolean;
  line: number;
  column: number;
}

export interface ImportBinding {
  name: string;
  alias: string | undefined;
  isNamespace: boolean;
  isDefault: boolean;
  isTypeOnly: boolean;
  isRedundantAlias?: boolean;
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

export interface SourceModuleRedundantTypePattern {
  typeName: string;
  kind: RedundantTypePatternKind;
  line: number;
  column: number;
  reason: string;
  suggestion: string;
}

export interface SourceModuleIdentityWrapper {
  wrapperName: string;
  wrappedExpression: string;
  line: number;
  column: number;
}

export interface SourceModuleTypeDefinitionHash {
  typeName: string;
  structuralHash: string;
  line: number;
  column: number;
}

export interface SourceModuleInlineTypeLiteral {
  structuralHash: string;
  memberCount: number;
  preview: string;
  context: InlineTypeContext;
  nearestName?: string;
  line: number;
  column: number;
}

export interface SourceModuleSimplifiableFunction {
  kind: SimplifiableFunctionKind;
  functionName?: string;
  line: number;
  column: number;
  reason: string;
  suggestion: string;
}

export interface SourceModuleSimplifiableExpression {
  kind: SimplifiableExpressionKind;
  snippet: string;
  line: number;
  column: number;
  reason: string;
  suggestion: string;
}

export interface SourceModuleDuplicateConstantCandidate {
  constantName: string;
  literalHash: string;
  literalPreview: string;
  line: number;
  column: number;
}

export interface SourceModule {
  fileId: SourceFile;
  imports: ImportReference[];
  exports: ExportReference[];
  memberAccesses: MemberAccess[];
  wholeObjectUses: string[];
  localIdentifierReferences: string[];
  referencedFilenames: string[];
  redundantTypePatterns: SourceModuleRedundantTypePattern[];
  identityWrappers: SourceModuleIdentityWrapper[];
  typeDefinitionHashes: SourceModuleTypeDefinitionHash[];
  inlineTypeLiterals: SourceModuleInlineTypeLiteral[];
  simplifiableFunctions: SourceModuleSimplifiableFunction[];
  simplifiableExpressions: SourceModuleSimplifiableExpression[];
  duplicateConstantCandidates: SourceModuleDuplicateConstantCandidate[];
  parseErrors: DeslopError[];
  isEntryPoint: boolean;
  isTestEntry: boolean;
  isReachable: boolean;
  isDeclarationFile: boolean;
  isConfigFile: boolean;
  isGitIgnored: boolean;
}

export interface ReExportMapping {
  exportedName: string;
  originalName: string;
}

export interface Edge {
  source: number;
  target: number;
  importedSymbols: LinkedSymbol[];
  isReExportEdge: boolean;
  reExportedNames: string[];
  reExportMappings: ReExportMapping[];
}

export interface LinkedSymbol {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
  isNamespace: boolean;
  isDefault: boolean;
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

export interface CircularDependency {
  files: string[];
}

export type SemanticConfidence = "high" | "medium" | "low";

export type UnusedTypeKind = "interface" | "type-alias" | "enum-type";

export interface UnusedType {
  path: string;
  name: string;
  line: number;
  column: number;
  kind: UnusedTypeKind;
  confidence: SemanticConfidence;
  reason: string;
  trace: string[];
  suppressionHint?: string;
}

export type DependencyDeclaredAs = "dependencies" | "peerDependencies";

export interface MisclassifiedDependency {
  name: string;
  declaredAs: DependencyDeclaredAs;
  suggestedAs: "devDependencies";
  confidence: SemanticConfidence;
  reason: string;
  trace: string[];
}

export interface UnusedEnumMember {
  path: string;
  enumName: string;
  memberName: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  trace: string[];
}

export type ClassMemberKind = "method" | "property" | "accessor";

export interface UnusedClassMember {
  path: string;
  className: string;
  memberName: string;
  memberKind: ClassMemberKind;
  isStatic: boolean;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  trace: string[];
}

export type RedundantAliasKind =
  | "import-self-alias"
  | "export-self-alias"
  | "reexport-self-alias"
  | "variable-alias"
  | "reexport-aliased-not-used"
  | "roundtrip-alias";

export interface RedundantAlias {
  path: string;
  kind: RedundantAliasKind;
  name: string;
  aliasedFrom: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
}

export interface DuplicateExportOccurrence {
  line: number;
  column: number;
  reExportSource?: string;
  isReExport: boolean;
}

export interface DuplicateExport {
  path: string;
  name: string;
  occurrences: DuplicateExportOccurrence[];
  confidence: SemanticConfidence;
  reason: string;
}

export interface DuplicateImportOccurrence {
  line: number;
  column: number;
  importedNames: string[];
  isTypeOnly: boolean;
}

export interface DuplicateImport {
  path: string;
  specifier: string;
  occurrences: DuplicateImportOccurrence[];
  confidence: SemanticConfidence;
  reason: string;
}

export type RedundantTypePatternKind =
  | "intersection-with-empty-object"
  | "self-union"
  | "self-intersection"
  | "nested-partial"
  | "nested-readonly"
  | "nested-required"
  | "pick-all-keys"
  | "omit-no-keys"
  | "empty-interface-extends-one";

export interface RedundantTypePattern {
  path: string;
  typeName: string;
  kind: RedundantTypePatternKind;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  suggestion: string;
}

export interface IdentityWrapper {
  path: string;
  wrapperName: string;
  wrappedExpression: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
}

export interface DuplicateTypeDefinitionInstance {
  path: string;
  typeName: string;
  line: number;
  column: number;
}

export interface DuplicateTypeDefinition {
  structuralHash: string;
  instances: DuplicateTypeDefinitionInstance[];
  confidence: SemanticConfidence;
  reason: string;
}

export type InlineTypeContext =
  | "function-parameter"
  | "function-return"
  | "variable-annotation"
  | "local-type-alias"
  | "class-property"
  | "interface-property"
  | "generic-type-argument";

export interface InlineTypeOccurrence {
  path: string;
  line: number;
  column: number;
  context: InlineTypeContext;
  nearestName?: string;
}

export interface DuplicateInlineType {
  structuralHash: string;
  memberCount: number;
  preview: string;
  occurrences: InlineTypeOccurrence[];
  confidence: SemanticConfidence;
  reason: string;
}

export type SimplifiableFunctionKind =
  | "block-arrow-single-return"
  | "redundant-await-return"
  | "useless-async-no-await";

export interface SimplifiableFunction {
  path: string;
  kind: SimplifiableFunctionKind;
  functionName?: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  suggestion: string;
}

export type SimplifiableExpressionKind =
  | "self-fallback-ternary"
  | "double-bang-boolean"
  | "ternary-returns-boolean"
  | "nullish-coalescing-with-nullish"
  | "redundant-null-and-undefined-check";

export interface SimplifiableExpression {
  path: string;
  kind: SimplifiableExpressionKind;
  snippet: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  suggestion: string;
}

export interface DuplicateConstantOccurrence {
  path: string;
  constantName: string;
  line: number;
  column: number;
}

export interface DuplicateConstant {
  literalHash: string;
  literalPreview: string;
  occurrences: DuplicateConstantOccurrence[];
  confidence: SemanticConfidence;
  reason: string;
}

export interface CrossFileDuplicateExportLocation {
  path: string;
  line: number;
  column: number;
  isTypeOnly: boolean;
}

export interface CrossFileDuplicateExport {
  name: string;
  locations: CrossFileDuplicateExportLocation[];
  confidence: SemanticConfidence;
  reason: string;
}

export type DuplicateBlockDetectionMode = "strict" | "semantic";

export interface DuplicateBlockOccurrence {
  path: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

export interface DuplicateBlock {
  instances: DuplicateBlockOccurrence[];
  tokenCount: number;
  lineCount: number;
  confidence: SemanticConfidence;
  reason: string;
}

export type DuplicateBlockRefactoringKind = "extract-function" | "extract-module";

export interface DuplicateBlockRefactoringHint {
  kind: DuplicateBlockRefactoringKind;
  description: string;
  estimatedSavings: number;
}

export interface DuplicateBlockCluster {
  files: string[];
  groups: DuplicateBlock[];
  totalDuplicatedLines: number;
  totalDuplicatedTokens: number;
  suggestions: DuplicateBlockRefactoringHint[];
}

export interface ShadowedDirectoryPair {
  directoryA: string;
  directoryB: string;
  sharedFiles: string[];
  totalDuplicatedLines: number;
}

export interface DuplicateBlocksConfig {
  enabled: boolean;
  mode: DuplicateBlockDetectionMode;
  minTokens: number;
  minLines: number;
  minOccurrences: number;
  skipLocal: boolean;
}

export type ReExportCycleKind = "self-loop" | "multi-node";

export interface ReExportCycle {
  files: string[];
  kind: ReExportCycleKind;
  confidence: SemanticConfidence;
  reason: string;
}

export type FeatureFlagKind = "env-var" | "sdk-call" | "config-object";

export interface FeatureFlag {
  path: string;
  name: string;
  kind: FeatureFlagKind;
  line: number;
  column: number;
  sdkProvider?: string;
  guardLineStart?: number;
  guardLineEnd?: number;
  guardsDeadCode: boolean;
}

export interface FeatureFlagsConfig {
  enabled: boolean;
  extraEnvPrefixes: string[];
  extraSdkFunctionNames: string[];
  detectConfigObjects: boolean;
}

export interface FunctionComplexity {
  path: string;
  functionName: string;
  line: number;
  column: number;
  cyclomatic: number;
  cognitive: number;
  lineCount: number;
  paramCount: number;
  confidence: SemanticConfidence;
  reason: string;
}

export interface ComplexityConfig {
  enabled: boolean;
  cyclomaticThreshold: number;
  cognitiveThreshold: number;
  paramCountThreshold: number;
  functionLineThreshold: number;
}

export interface PrivateTypeLeak {
  path: string;
  exportName: string;
  typeName: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
}

export type UnnecessaryAssertionKind =
  | "redundant-double-assertion"
  | "assertion-to-any"
  | "redundant-non-null-on-literal"
  | "double-non-null"
  | "angle-bracket-assertion";

export interface UnnecessaryAssertion {
  path: string;
  kind: UnnecessaryAssertionKind;
  snippet: string;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  suggestion: string;
}

export type LazyImportKind = "top-level-await-import" | "top-level-then-import";

export interface LazyImportAtTopLevel {
  path: string;
  specifier: string;
  kind: LazyImportKind;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
}

export type CommonjsInEsmKind = "require" | "module-exports" | "exports-assignment";

export interface CommonjsInEsm {
  path: string;
  kind: CommonjsInEsmKind;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  snippet: string;
}

export type TypeScriptEscapeHatchKind =
  | "ts-ignore"
  | "ts-nocheck"
  | "ts-expect-error-without-explanation";

export interface TypeScriptEscapeHatch {
  path: string;
  kind: TypeScriptEscapeHatchKind;
  line: number;
  column: number;
  confidence: SemanticConfidence;
  reason: string;
  suggestion: string;
}

export interface ScanResult {
  unusedFiles: UnusedFile[];
  unusedExports: UnusedExport[];
  unusedDependencies: UnusedDependency[];
  circularDependencies: CircularDependency[];
  unusedTypes: UnusedType[];
  misclassifiedDependencies: MisclassifiedDependency[];
  unusedEnumMembers: UnusedEnumMember[];
  unusedClassMembers: UnusedClassMember[];
  redundantAliases: RedundantAlias[];
  duplicateExports: DuplicateExport[];
  duplicateImports: DuplicateImport[];
  redundantTypePatterns: RedundantTypePattern[];
  identityWrappers: IdentityWrapper[];
  duplicateTypeDefinitions: DuplicateTypeDefinition[];
  duplicateInlineTypes: DuplicateInlineType[];
  simplifiableFunctions: SimplifiableFunction[];
  simplifiableExpressions: SimplifiableExpression[];
  duplicateConstants: DuplicateConstant[];
  crossFileDuplicateExports: CrossFileDuplicateExport[];
  duplicateBlocks: DuplicateBlock[];
  duplicateBlockClusters: DuplicateBlockCluster[];
  shadowedDirectoryPairs: ShadowedDirectoryPair[];
  reExportCycles: ReExportCycle[];
  featureFlags: FeatureFlag[];
  complexFunctions: FunctionComplexity[];
  privateTypeLeaks: PrivateTypeLeak[];
  unnecessaryAssertions: UnnecessaryAssertion[];
  lazyImportsAtTopLevel: LazyImportAtTopLevel[];
  commonjsInEsm: CommonjsInEsm[];
  typeScriptEscapeHatches: TypeScriptEscapeHatch[];
  analysisErrors: DeslopError[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
}

export interface ResolvedEntries {
  productionEntries: string[];
  testEntries: string[];
  alwaysUsedFiles: string[];
}

export interface SemanticConfig {
  enabled: boolean;
  reportUnusedTypes: boolean;
  reportUnusedEnumMembers: boolean;
  reportUnusedClassMembers: boolean;
  reportRedundantVariableAliases: boolean;
  reportMisclassifiedDependencies: boolean;
  reportRoundTripAliases: boolean;
  decoratorAllowlist: string[];
}

export interface DeslopConfig {
  rootDir: string;
  entryPatterns: string[];
  ignorePatterns: string[];
  includeExtensions: string[];
  tsConfigPath: string | undefined;
  paths: Record<string, string[]> | undefined;
  reportTypes: boolean;
  includeEntryExports: boolean;
  reportRedundancy: boolean;
  /**
   * Run the non-dead-code "code quality" detectors — duplicate-block (copy-paste)
   * detection, complexity hotspots, feature flags, TypeScript smells,
   * private-type leaks, and re-export cycles. On by default. These are by far
   * the most expensive detectors (duplicate-block detection alone can dominate
   * a large-repo scan), and they're independent of the dead-code graph findings
   * (unused files/exports/dependencies, circular dependencies) — so a consumer
   * that only wants dead-code can set this `false` to skip the bulk of the work.
   */
  reportCodeQuality: boolean;
  semantic: SemanticConfig | undefined;
  duplicateBlocks: DuplicateBlocksConfig | undefined;
  featureFlags: FeatureFlagsConfig | undefined;
  complexity: ComplexityConfig | undefined;
}
