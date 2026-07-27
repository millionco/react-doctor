import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findPublishedPackageManifests,
  type PackageManifest,
} from "../utils/find-published-package-manifests.ts";
import { CLI_HELP_INVOCATIONS } from "./cli-help-invocations.ts";
import type {
  CliHelpSnapshotEntry,
  PackedPublicEntryPointSnapshot,
} from "./public-package-snapshot-types.ts";
import { readPackageExportValue } from "../utils/read-package-export-value.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const PACKAGES_DIRECTORY = path.join(REPOSITORY_ROOT, "packages");
const SNAPSHOT_DIRECTORY = path.join(REPOSITORY_ROOT, "compatibility", "snapshots");
const PUBLIC_PACKAGES_SNAPSHOT_PATH = path.join(SNAPSHOT_DIRECTORY, "public-packages.json");
const CLI_HELP_SNAPSHOT_PATH = path.join(SNAPSHOT_DIRECTORY, "cli-help.json");
const PACKED_ENTRY_SNAPSHOT_PATH = path.join(SNAPSHOT_DIRECTORY, "packed-public-entry-points.json");

interface PublicPackageSnapshot {
  readonly name: string;
  readonly directory: string;
  readonly type: string | null;
  readonly main: string | null;
  readonly module: string | null;
  readonly types: string | null;
  readonly bin: PackageManifest["bin"] | null;
  readonly exports: unknown;
  readonly files: ReadonlyArray<string>;
  readonly sideEffects: PackageManifest["sideEffects"] | null;
  readonly engines: PackageManifest["engines"] | null;
  readonly peerDependencies: PackageManifest["peerDependencies"] | null;
}

interface PackageExportsSnapshot {
  readonly exports?: unknown;
}

const buildPublicPackageSnapshots = (): ReadonlyArray<PublicPackageSnapshot> =>
  findPublishedPackageManifests(PACKAGES_DIRECTORY).map(({ directory, manifest }) => ({
    name: manifest.name,
    directory: path.relative(REPOSITORY_ROOT, directory).split(path.sep).join("/"),
    type: manifest.type ?? null,
    main: manifest.main ?? null,
    module: manifest.module ?? null,
    types: manifest.types ?? null,
    bin: manifest.bin ?? null,
    exports: manifest.exports ?? null,
    files: manifest.files ?? [],
    sideEffects: manifest.sideEffects ?? null,
    engines: manifest.engines ?? null,
    peerDependencies: manifest.peerDependencies ?? null,
  }));

const serializeSnapshots = (snapshots: ReadonlyArray<PublicPackageSnapshot>): string =>
  `${JSON.stringify(snapshots, null, 2)}\n`;

const readJson = <Value>(filePath: string): Value => JSON.parse(fs.readFileSync(filePath, "utf8"));

const collectExportSubpaths = (manifest: PackageExportsSnapshot): string[] => {
  if (manifest.exports === undefined || manifest.exports === null) return [];
  if (
    typeof manifest.exports !== "object" ||
    manifest.exports === null ||
    Array.isArray(manifest.exports)
  ) {
    return ["."];
  }

  const exportKeys = Object.keys(manifest.exports);
  const subpaths = exportKeys.filter((exportKey) => exportKey.startsWith("."));
  return subpaths.length > 0 ? subpaths.sort() : ["."];
};

const collectRuntimeModes = (exportValue: unknown): Array<"import" | "require"> => {
  if (typeof exportValue === "string") return ["import"];
  if (typeof exportValue !== "object" || exportValue === null || Array.isArray(exportValue)) {
    return [];
  }

  const runtimeModes = new Set<"import" | "require">();
  for (const [condition, conditionValue] of Object.entries(exportValue)) {
    if (condition === "import") runtimeModes.add("import");
    else if (condition === "require") runtimeModes.add("require");
    else if (condition === "default") runtimeModes.add("import");
    else if (condition !== "types") {
      for (const nestedRuntimeMode of collectRuntimeModes(conditionValue)) {
        runtimeModes.add(nestedRuntimeMode);
      }
    }
  }
  return [...runtimeModes].sort();
};

const validatePackedSnapshotCoverage = (
  packageSnapshots: ReadonlyArray<PublicPackageSnapshot>,
): void => {
  for (const snapshotPath of [CLI_HELP_SNAPSHOT_PATH, PACKED_ENTRY_SNAPSHOT_PATH]) {
    if (!fs.existsSync(snapshotPath)) {
      console.error(`Missing ${path.relative(REPOSITORY_ROOT, snapshotPath)}.`);
      process.exit(1);
    }
  }

  const cliHelpSnapshot = readJson<ReadonlyArray<CliHelpSnapshotEntry>>(CLI_HELP_SNAPSHOT_PATH);
  const expectedHelpInvocations = CLI_HELP_INVOCATIONS.map(
    ({ name, arguments: argumentsList }) => ({
      name,
      arguments: argumentsList,
    }),
  );
  const snapshotHelpInvocations = cliHelpSnapshot.map(({ name, arguments: argumentsList }) => ({
    name,
    arguments: argumentsList,
  }));
  if (!isDeepStrictEqual(snapshotHelpInvocations, expectedHelpInvocations)) {
    console.error("CLI help snapshot does not cover the reviewed command and alias inventory.");
    process.exit(1);
  }

  const packedSnapshot = readJson<PackedPublicEntryPointSnapshot>(PACKED_ENTRY_SNAPSHOT_PATH);
  const expectedEntries = packageSnapshots
    .flatMap((packageSnapshot) =>
      collectExportSubpaths(packageSnapshot).map((subpath) => ({
        packageName: packageSnapshot.name,
        subpath,
      })),
    )
    .sort((leftEntry, rightEntry) => {
      const leftKey = `${leftEntry.packageName}\0${leftEntry.subpath}`;
      const rightKey = `${rightEntry.packageName}\0${rightEntry.subpath}`;
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      return 0;
    });
  const snapshotEntries = packedSnapshot.entries
    .map(({ packageName, subpath }) => ({ packageName, subpath }))
    .sort((leftEntry, rightEntry) => {
      const leftKey = `${leftEntry.packageName}\0${leftEntry.subpath}`;
      const rightKey = `${rightEntry.packageName}\0${rightEntry.subpath}`;
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      return 0;
    });
  if (!isDeepStrictEqual(snapshotEntries, expectedEntries)) {
    console.error("Packed runtime entry baseline does not cover every published export subpath.");
    process.exit(1);
  }
  const packageSnapshotByName = new Map(
    packageSnapshots.map((packageSnapshot) => [packageSnapshot.name, packageSnapshot]),
  );
  for (const entrySnapshot of packedSnapshot.entries) {
    if (entrySnapshot.executionOnly === true) {
      if (entrySnapshot.exportKeys !== undefined) {
        console.error(
          `Execution-only entry ${entrySnapshot.packageName}${entrySnapshot.subpath} must not pin runtime export keys.`,
        );
        process.exit(1);
      }
      continue;
    }
    if (entrySnapshot.exportKeys === undefined) {
      console.error(
        `Library entry ${entrySnapshot.packageName}${entrySnapshot.subpath} is missing runtime export keys.`,
      );
      process.exit(1);
    }
    const packageSnapshot = packageSnapshotByName.get(entrySnapshot.packageName);
    const exportValue = readPackageExportValue(packageSnapshot?.exports, entrySnapshot.subpath);
    const expectedRuntimeModes = collectRuntimeModes(exportValue);
    const snapshotRuntimeModes = Object.keys(entrySnapshot.exportKeys).sort();
    if (!isDeepStrictEqual(snapshotRuntimeModes, expectedRuntimeModes)) {
      console.error(
        `Runtime export baseline modes do not match ${entrySnapshot.packageName}${entrySnapshot.subpath}.`,
      );
      process.exit(1);
    }
  }

  const expectedPackageNames = packageSnapshots.map(({ name }) => name).sort();
  const policyPackageNames = packedSnapshot.filePolicies
    .map(({ packageName }) => packageName)
    .sort();
  if (!isDeepStrictEqual(policyPackageNames, expectedPackageNames)) {
    console.error("Packed file policies do not cover every published package.");
    process.exit(1);
  }
};

const argumentsList = process.argv.slice(2);
const shouldUpdate = argumentsList.length === 1 && argumentsList[0] === "--update";
if (argumentsList.length > 0 && !shouldUpdate) {
  console.error("Usage: node scripts/compatibility/check-public-packages.ts [--update]");
  process.exit(1);
}

const currentSnapshots = buildPublicPackageSnapshots();

if (shouldUpdate) {
  fs.mkdirSync(path.dirname(PUBLIC_PACKAGES_SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(PUBLIC_PACKAGES_SNAPSHOT_PATH, serializeSnapshots(currentSnapshots));
  console.log(`Updated ${path.relative(REPOSITORY_ROOT, PUBLIC_PACKAGES_SNAPSHOT_PATH)}.`);
  process.exit(0);
}

if (!fs.existsSync(PUBLIC_PACKAGES_SNAPSHOT_PATH)) {
  console.error(`Missing ${path.relative(REPOSITORY_ROOT, PUBLIC_PACKAGES_SNAPSHOT_PATH)}.`);
  console.error("Run `nr compatibility:update` after reviewing the public surface.");
  process.exit(1);
}

const expectedSnapshots = JSON.parse(fs.readFileSync(PUBLIC_PACKAGES_SNAPSHOT_PATH, "utf8"));
if (!isDeepStrictEqual(currentSnapshots, expectedSnapshots)) {
  console.error("Published package compatibility snapshot drift detected.");
  console.error(
    "Review the package surface, then run `nr compatibility:update` if it is intentional.",
  );
  process.exit(1);
}

validatePackedSnapshotCoverage(currentSnapshots);
console.log(`Public package compatibility matches for ${currentSnapshots.length} packages.`);
