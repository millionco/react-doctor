import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findPublishedPackageManifests,
  type PackageManifest,
} from "./utils/find-published-package-manifests.ts";
import { CLI_HELP_INVOCATIONS } from "./utils/cli-help-invocations.ts";
import type {
  CliHelpSnapshotEntry,
  PackedPublicEntryPointSnapshot,
} from "./utils/public-package-contract-types.ts";
import { readPackageExportValue } from "./utils/read-package-export-value.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const PACKAGES_DIRECTORY = path.join(REPOSITORY_ROOT, "packages");
const SNAPSHOT_PATH = path.join(REPOSITORY_ROOT, "contracts", "public-packages.json");
const CLI_HELP_SNAPSHOT_PATH = path.join(REPOSITORY_ROOT, "contracts", "cli-help.json");
const PACKED_ENTRY_SNAPSHOT_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "packed-public-entry-points.json",
);

interface PublicPackageContract {
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

interface PackageExportsContract {
  readonly exports?: unknown;
}

const buildPublicPackageContracts = (): ReadonlyArray<PublicPackageContract> =>
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

const serializeContracts = (contracts: ReadonlyArray<PublicPackageContract>): string =>
  `${JSON.stringify(contracts, null, 2)}\n`;

const readJson = <Value>(filePath: string): Value => JSON.parse(fs.readFileSync(filePath, "utf8"));

const collectExportSubpaths = (manifest: PackageExportsContract): string[] => {
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

const validatePackedContractCoverage = (
  packageContracts: ReadonlyArray<PublicPackageContract>,
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
  const expectedEntries = packageContracts
    .flatMap((packageContract) =>
      collectExportSubpaths(packageContract).map((subpath) => ({
        packageName: packageContract.name,
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
  const packageContractByName = new Map(
    packageContracts.map((packageContract) => [packageContract.name, packageContract]),
  );
  for (const entryContract of packedSnapshot.entries) {
    if (entryContract.executionOnly === true) {
      if (entryContract.exportKeys !== undefined) {
        console.error(
          `Execution-only entry ${entryContract.packageName}${entryContract.subpath} must not pin runtime export keys.`,
        );
        process.exit(1);
      }
      continue;
    }
    if (entryContract.exportKeys === undefined) {
      console.error(
        `Library entry ${entryContract.packageName}${entryContract.subpath} is missing runtime export keys.`,
      );
      process.exit(1);
    }
    const packageContract = packageContractByName.get(entryContract.packageName);
    const exportValue = readPackageExportValue(packageContract?.exports, entryContract.subpath);
    const expectedRuntimeModes = collectRuntimeModes(exportValue);
    const snapshotRuntimeModes = Object.keys(entryContract.exportKeys).sort();
    if (!isDeepStrictEqual(snapshotRuntimeModes, expectedRuntimeModes)) {
      console.error(
        `Runtime export baseline modes do not match ${entryContract.packageName}${entryContract.subpath}.`,
      );
      process.exit(1);
    }
  }

  const expectedPackageNames = packageContracts.map(({ name }) => name).sort();
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
  console.error("Usage: node scripts/check-public-package-contracts.ts [--update]");
  process.exit(1);
}

const currentContracts = buildPublicPackageContracts();

if (shouldUpdate) {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, serializeContracts(currentContracts));
  console.log(`Updated ${path.relative(REPOSITORY_ROOT, SNAPSHOT_PATH)}.`);
  process.exit(0);
}

if (!fs.existsSync(SNAPSHOT_PATH)) {
  console.error(`Missing ${path.relative(REPOSITORY_ROOT, SNAPSHOT_PATH)}.`);
  console.error("Run `nr contracts:update` after reviewing the public surface.");
  process.exit(1);
}

const expectedContracts = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
if (!isDeepStrictEqual(currentContracts, expectedContracts)) {
  console.error("Published package contract drift detected.");
  console.error("Review the package surface, then run `nr contracts:update` if it is intentional.");
  process.exit(1);
}

validatePackedContractCoverage(currentContracts);
console.log(`Public package contracts match for ${currentContracts.length} packages.`);
