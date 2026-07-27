import * as fs from "node:fs";
import * as path from "node:path";

export interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly files?: ReadonlyArray<string>;
  readonly sideEffects?: boolean | ReadonlyArray<string>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

export interface PublishedPackageManifest {
  readonly directory: string;
  readonly manifest: PackageManifest;
}

export const readPackageManifest = (packageDirectory: string): PackageManifest =>
  JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));

export const findPublishedPackageManifests = (
  packagesDirectory: string,
): ReadonlyArray<PublishedPackageManifest> =>
  fs
    .readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDirectory, entry.name))
    .filter((packageDirectory) => fs.existsSync(path.join(packageDirectory, "package.json")))
    .map((directory) => ({
      directory,
      manifest: readPackageManifest(directory),
    }))
    .filter(({ manifest }) => manifest.private !== true)
    .sort((leftPackage, rightPackage) => {
      if (leftPackage.manifest.name < rightPackage.manifest.name) return -1;
      if (leftPackage.manifest.name > rightPackage.manifest.name) return 1;
      return 0;
    });
