export interface AnalyzeOptions {
  root: string;
  entry?: string[];
  ignore?: string[];
  extensions?: string[];
  tsconfig?: string;
  paths?: Record<string, string[]>;
  reportTypes: boolean;
  includeEntryExports: boolean;
  json: boolean;
  failOnIssues: boolean;
  failOnCycles: boolean;
}

export interface RootValidationResult {
  isValid: boolean;
  resolvedPath: string;
  errorMessage?: string;
  missingPackageJson: boolean;
}
