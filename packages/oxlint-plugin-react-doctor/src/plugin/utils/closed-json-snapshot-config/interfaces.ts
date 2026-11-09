export interface ClosedJsonSnapshotSourceAlias {
  readonly name: string;
  readonly exact: boolean;
  readonly targetAbsolutePath: string;
}

export interface ClosedJsonSnapshotSourceResolutionPolicy {
  readonly rootDirectory: string;
  readonly extensions: ReadonlyArray<string>;
  readonly aliases: ReadonlyArray<ClosedJsonSnapshotSourceAlias>;
  readonly configFilePaths?: ReadonlyArray<string>;
}

export interface ClosedJsonSnapshotSourceResolutionInput {
  readonly rootDirectory: string;
  readonly configFilePath: string;
}

export interface SnapshotConfigValue {
  readonly kind: "scalar" | "object" | "array" | "path" | "binding" | "deferred";
  readonly resolve?: () => SnapshotConfigValue;
  readonly scalar?: string | number | boolean | null;
  readonly properties?: ReadonlyMap<string, SnapshotConfigValue>;
  readonly elements?: ReadonlyArray<SnapshotConfigValue>;
  readonly binding?: string;
}

export interface SnapshotConfigDataBudget {
  remaining: number;
}
