import type { PackageManifest } from "../../plugin/utils/read-nearest-package-manifest.js";

export interface ResourceDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
}

export interface ResourceDirectoryListing {
  readonly entries: ReadonlyArray<ResourceDirectoryEntry>;
  readonly didReachLimit: boolean;
}

export interface ResourcePackage {
  readonly directoryPath: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
}

export interface ResourceDependency {
  readonly name: string;
  readonly packageDirectory: string;
  readonly section:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly rawSpecifier: string;
  readonly installedVersion: string | null;
}

export interface ResourceHost {
  readonly rootDirectory: string;
  readonly normalizePath: (resourcePath: string) => string;
  readonly readSource: (filePath: string) => string | null;
  readonly readManifest: (manifestPath: string) => PackageManifest | null;
  readonly getPathKind: (resourcePath: string) => "file" | "directory" | "other" | null;
  readonly fileExists: (filePath: string) => boolean;
  readonly directoryExists: (directoryPath: string) => boolean;
  readonly listDirectory: (
    directoryPath: string,
    maximumEntries: number,
  ) => ResourceDirectoryListing;
  readonly resolveModuleFile: (absoluteModulePath: string) => string | null;
  readonly resolveRelativeImport: (fromFilename: string, source: string) => string | null;
  readonly resolveTsconfigAlias: (fromFilename: string, source: string) => string | null;
  readonly resolveImport: (fromFilename: string, source: string) => string | null;
  readonly findOwningPackage: (filePath: string) => ResourcePackage | null;
  readonly getDependency: (filePath: string, dependencyName: string) => ResourceDependency | null;
}

export interface ResourceHostBackend {
  readonly rootDirectory: string;
  readonly normalizePath: (resourcePath: string) => string;
  readonly readText: (filePath: string) => string | null;
  readonly getPathKind: (resourcePath: string) => "file" | "directory" | "other" | null;
  readonly readDirectory: (directoryPath: string) => ReadonlyArray<ResourceDirectoryEntry>;
}

export interface RealFilesystemResourceHostInput {
  readonly rootDirectory: string;
}

export interface InMemoryResourceHostInput {
  readonly rootDirectory: string;
  readonly files: ReadonlyMap<string, string>;
  readonly directories?: ReadonlyArray<string>;
  readonly packages?: ReadonlyArray<InMemoryResourcePackageInput>;
}

export interface InMemoryResourcePackageInput {
  readonly directoryPath: string;
  readonly manifest: PackageManifest;
  readonly installedDependencyVersions?: Readonly<Record<string, string>>;
}
