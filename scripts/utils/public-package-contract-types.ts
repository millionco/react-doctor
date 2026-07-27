export interface CliHelpSnapshotEntry {
  readonly name: string;
  readonly arguments: ReadonlyArray<string>;
  readonly output: string;
}

export interface PackedEntryContract {
  readonly packageName: string;
  readonly subpath: string;
  readonly executionOnly?: boolean;
  readonly exportKeys?: {
    readonly import?: ReadonlyArray<string>;
    readonly require?: ReadonlyArray<string>;
  };
}

export interface PackedFilePolicy {
  readonly packageName: string;
  readonly requiredFiles: ReadonlyArray<string>;
  readonly allowedPatterns: ReadonlyArray<string>;
  readonly deniedPatterns: ReadonlyArray<string>;
}

export interface PackedPublicEntryPointSnapshot {
  readonly entries: ReadonlyArray<PackedEntryContract>;
  readonly filePolicies: ReadonlyArray<PackedFilePolicy>;
}
