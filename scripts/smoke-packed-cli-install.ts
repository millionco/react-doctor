import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CLI_HELP_INVOCATIONS } from "./utils/cli-help-invocations.ts";
import { normalizeCliHelp } from "./utils/normalize-cli-help.ts";
import { parseHelpCommandAliases } from "./utils/parse-help-command-aliases.ts";
import type {
  CliHelpSnapshotEntry,
  PackedEntryContract,
  PackedFilePolicy,
  PackedPublicEntryPointSnapshot,
} from "./utils/public-package-contract-types.ts";
import { readPackageExportValue } from "./utils/read-package-export-value.ts";

interface CommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly allowedStatuses?: readonly number[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly needsShell?: boolean;
}

interface StringRecord {
  readonly [key: string]: unknown;
}

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_DIRECTORY = path.resolve(REPOSITORY_ROOT, "packages/core/tests/fixtures/basic-react");
const CLI_HELP_SNAPSHOT_PATH = path.join(REPOSITORY_ROOT, "contracts", "cli-help.json");
const PACKED_ENTRY_SNAPSHOT_PATH = path.join(
  REPOSITORY_ROOT,
  "contracts",
  "packed-public-entry-points.json",
);
const FORBIDDEN_INSTALLED_PACKAGES: readonly string[] = [
  "ini",
  "effect",
  "@effect/platform-node-shared",
];
const COMMAND_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;
const RUNTIME_EXPORT_MARKER = "REACT_DOCTOR_RUNTIME_EXPORTS=";

const isRecord = (value: unknown): value is StringRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const runCommand = (input: CommandInput) => {
  const result = spawnSync(input.command, [...input.args], {
    cwd: input.cwd,
    encoding: "utf-8",
    env: input.environment,
    maxBuffer: COMMAND_OUTPUT_MAX_BYTES,
    shell: input.needsShell === true,
  });
  const status = result.status ?? 1;
  const allowedStatuses = input.allowedStatuses ?? [0];
  if (result.error !== undefined || !allowedStatuses.includes(status)) {
    console.error(`Command failed: ${[input.command, ...input.args].join(" ")}`);
    console.error(`cwd: ${input.cwd}`);
    console.error(`status: ${status}`);
    if (result.error !== undefined) console.error(result.error);
    if (result.stdout.trim() !== "") console.error("stdout:", result.stdout);
    if (result.stderr.trim() !== "") console.error("stderr:", result.stderr);
    process.exit(1);
  }
  return result;
};

const readJson = <Value>(filePath: string): Value => JSON.parse(fs.readFileSync(filePath, "utf8"));

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const toPosixPath = (filePath: string): string => filePath.split(path.sep).join("/");

const collectPackageFiles = (packageDirectory: string): string[] => {
  const packageFiles: string[] = [];
  const pendingDirectories = [packageDirectory];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) break;

    for (const directoryEntry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (directoryEntry.name === "node_modules") continue;
      const entryPath = path.join(currentDirectory, directoryEntry.name);
      if (directoryEntry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (directoryEntry.isFile()) {
        packageFiles.push(toPosixPath(path.relative(packageDirectory, entryPath)));
      }
    }
  }
  return packageFiles.sort();
};

const matchesPackedFilePattern = (filePath: string, pattern: string): boolean => {
  if (pattern.startsWith("**/*")) return filePath.endsWith(pattern.slice(4));
  if (!pattern.endsWith("/**")) return filePath === pattern;
  const directoryPrefix = pattern.slice(0, -3);
  return filePath === directoryPrefix || filePath.startsWith(`${directoryPrefix}/`);
};

const assertPackedFilePolicy = (packageDirectory: string, policy: PackedFilePolicy): void => {
  const packageFiles = collectPackageFiles(packageDirectory);
  const missingFiles = policy.requiredFiles.filter(
    (requiredFile) => !packageFiles.includes(requiredFile),
  );
  const disallowedFiles = packageFiles.filter(
    (packageFile) =>
      !policy.allowedPatterns.some((allowedPattern) =>
        matchesPackedFilePattern(packageFile, allowedPattern),
      ),
  );
  const explicitlyDeniedFiles = packageFiles.filter((packageFile) =>
    policy.deniedPatterns.some((deniedPattern) =>
      matchesPackedFilePattern(packageFile, deniedPattern),
    ),
  );
  if (
    missingFiles.length === 0 &&
    disallowedFiles.length === 0 &&
    explicitlyDeniedFiles.length === 0
  ) {
    return;
  }

  console.error(`Packed file policy failed for ${policy.packageName}.`);
  if (missingFiles.length > 0) console.error(`Missing: ${missingFiles.join(", ")}`);
  if (disallowedFiles.length > 0) console.error(`Not allowed: ${disallowedFiles.join(", ")}`);
  if (explicitlyDeniedFiles.length > 0) {
    console.error(`Explicitly denied: ${explicitlyDeniedFiles.join(", ")}`);
  }
  process.exit(1);
};

const collectConditionalTargets = (exportValue: unknown, conditionName: string): string[] => {
  if (!isRecord(exportValue)) return [];
  const targets: string[] = [];
  for (const [condition, conditionValue] of Object.entries(exportValue)) {
    if (condition === conditionName && typeof conditionValue === "string") {
      targets.push(conditionValue);
    } else {
      targets.push(...collectConditionalTargets(conditionValue, conditionName));
    }
  }
  return targets;
};

const collectRuntimeTargets = (exportValue: unknown): string[] => {
  if (typeof exportValue === "string") return [exportValue];
  if (!isRecord(exportValue)) return [];

  return Object.entries(exportValue).flatMap(([condition, conditionValue]) =>
    condition === "types" ? [] : collectRuntimeTargets(conditionValue),
  );
};

const assertPackedEntryFiles = (
  installDirectory: string,
  entryContracts: ReadonlyArray<PackedEntryContract>,
): void => {
  for (const entryContract of entryContracts) {
    const packageDirectory = path.join(installDirectory, "node_modules", entryContract.packageName);
    const manifest = readJson<StringRecord>(path.join(packageDirectory, "package.json"));
    const exportValue = readPackageExportValue(manifest.exports, entryContract.subpath);
    const runtimeTargets = collectRuntimeTargets(exportValue);
    const declarationTargets = collectConditionalTargets(exportValue, "types");

    for (const target of [...runtimeTargets, ...declarationTargets]) {
      const targetPath = path.resolve(packageDirectory, target);
      if (!fs.existsSync(targetPath)) {
        console.error(
          `Packed entry ${entryContract.packageName}${entryContract.subpath} points to missing ${target}.`,
        );
        process.exit(1);
      }
    }

    const hasJavaScriptRuntime = runtimeTargets.some((target) =>
      [".js", ".mjs", ".cjs"].includes(path.extname(target)),
    );
    if (hasJavaScriptRuntime && declarationTargets.length === 0) {
      console.error(
        `Packed entry ${entryContract.packageName}${entryContract.subpath} has no declaration target.`,
      );
      process.exit(1);
    }
  }
};

const assertPackedBins = (packageDirectory: string): void => {
  const manifest = readJson<StringRecord>(path.join(packageDirectory, "package.json"));
  const binValue = manifest.bin;
  let binTargets: string[] = [];
  if (typeof binValue === "string") {
    binTargets = [binValue];
  } else if (isRecord(binValue)) {
    binTargets = Object.values(binValue).filter(
      (target): target is string => typeof target === "string",
    );
  }
  for (const binTarget of binTargets) {
    if (fs.existsSync(path.resolve(packageDirectory, binTarget))) continue;
    console.error(`Packed bin target is missing: ${packageDirectory} -> ${binTarget}.`);
    process.exit(1);
  }
};

const toPackageSpecifier = (entryContract: PackedEntryContract): string =>
  entryContract.subpath === "."
    ? entryContract.packageName
    : `${entryContract.packageName}/${entryContract.subpath.slice(2)}`;

const probeRuntimeExportKeys = (
  installDirectory: string,
  entryContract: PackedEntryContract,
  moduleMode: "import" | "require",
): string[] => {
  const packageSpecifier = toPackageSpecifier(entryContract);
  const importAttributes = packageSpecifier.endsWith("/package.json")
    ? ', { with: { type: "json" } }'
    : "";
  let probeSource: string;
  if (moduleMode === "import") {
    probeSource = `const namespace = await import(${JSON.stringify(packageSpecifier)}${importAttributes});
process.stdout.write(${JSON.stringify(RUNTIME_EXPORT_MARKER)} + JSON.stringify(Object.keys(namespace).sort()) + "\\n");`;
  } else {
    probeSource = `const { createRequire } = await import("node:module");
const namespace = createRequire(import.meta.url)(${JSON.stringify(packageSpecifier)});
process.stdout.write(${JSON.stringify(RUNTIME_EXPORT_MARKER)} + JSON.stringify(Object.keys(namespace).sort()) + "\\n");`;
  }
  const result = runCommand({
    command: process.execPath,
    args: ["--input-type=module", "--eval", probeSource],
    cwd: installDirectory,
    environment: {
      ...process.env,
      NO_COLOR: "1",
      REACT_DOCTOR_NO_TELEMETRY: "1",
    },
  });
  const markerLine = result.stdout
    .split(/\r?\n/)
    .find((outputLine) => outputLine.startsWith(RUNTIME_EXPORT_MARKER));
  if (markerLine === undefined) {
    console.error(`Runtime export probe produced no result for ${packageSpecifier}.`);
    process.exit(1);
  }
  return JSON.parse(markerLine.slice(RUNTIME_EXPORT_MARKER.length));
};

const captureRuntimeEntryContracts = (
  installDirectory: string,
  entryContracts: ReadonlyArray<PackedEntryContract>,
): PackedEntryContract[] =>
  entryContracts.map((entryContract) => {
    if (entryContract.executionOnly === true) return entryContract;
    if (entryContract.exportKeys === undefined) {
      console.error(
        `Library entry ${entryContract.packageName}${entryContract.subpath} is missing runtime export keys.`,
      );
      process.exit(1);
    }
    const exportKeys: { import?: ReadonlyArray<string>; require?: ReadonlyArray<string> } = {};
    if (entryContract.exportKeys.import !== undefined) {
      exportKeys.import = probeRuntimeExportKeys(installDirectory, entryContract, "import");
    }
    if (entryContract.exportKeys.require !== undefined) {
      exportKeys.require = probeRuntimeExportKeys(installDirectory, entryContract, "require");
    }
    return { ...entryContract, exportKeys };
  });

const captureCliHelpSnapshot = (
  cliModulePath: string,
  version: string,
): { snapshot: CliHelpSnapshotEntry[]; rawOutputByName: ReadonlyMap<string, string> } => {
  const workingDirectory = os.tmpdir();
  const rawOutputByName = new Map<string, string>();
  const snapshot = CLI_HELP_INVOCATIONS.map(({ name, arguments: argumentsList }) => {
    const result = runCommand({
      command: process.execPath,
      args: [cliModulePath, ...argumentsList],
      cwd: workingDirectory,
      environment: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    rawOutputByName.set(name, result.stdout);
    return {
      name,
      arguments: argumentsList,
      output: normalizeCliHelp(result.stdout, workingDirectory, version),
    };
  });
  return { snapshot, rawOutputByName };
};

const assertHelpCommandCoverage = (rawOutputByName: ReadonlyMap<string, string>): void => {
  const invocationPaths = new Set(
    CLI_HELP_INVOCATIONS.map(({ arguments: argumentsList }) =>
      argumentsList.filter((argument) => argument !== "--help").join(" "),
    ),
  );
  for (const [parentName, parentPath] of [
    ["root", ""],
    ["ci", "ci"],
    ["rules", "rules"],
  ]) {
    const parentHelp = rawOutputByName.get(parentName);
    if (parentHelp === undefined) {
      console.error(`Missing captured help for ${parentName}.`);
      process.exit(1);
    }
    for (const commandAlias of parseHelpCommandAliases(parentHelp)) {
      const commandPath = [parentPath, commandAlias].filter(Boolean).join(" ");
      if (!invocationPaths.has(commandPath)) {
        console.error(`CLI help baseline is missing the supported command "${commandPath}".`);
        process.exit(1);
      }
    }
  }
};

const readPackageName = (packageDirectory: string): string | null => {
  const packageJsonPath = path.join(packageDirectory, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(parsed) || typeof parsed.name !== "string") return null;
  return parsed.name;
};

const collectInstalledPackageNames = (nodeModulesDirectory: string): Set<string> => {
  const packageNames = new Set<string>();
  if (!fs.existsSync(nodeModulesDirectory)) return packageNames;

  const visitPackageDirectory = (packageDirectory: string): void => {
    const packageName = readPackageName(packageDirectory);
    if (packageName !== null) packageNames.add(packageName);
    visitNodeModules(path.join(packageDirectory, "node_modules"));
  };

  const visitNodeModules = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".bin") continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
          if (scopedEntry.isDirectory()) {
            visitPackageDirectory(path.join(entryPath, scopedEntry.name));
          }
        }
      } else {
        visitPackageDirectory(entryPath);
      }
    }
  };

  visitNodeModules(nodeModulesDirectory);
  return packageNames;
};

const assertFixtureExists = (): void => {
  if (fs.existsSync(FIXTURE_DIRECTORY)) return;
  console.error(`Fixture missing at ${FIXTURE_DIRECTORY}.`);
  process.exit(1);
};

const main = (): void => {
  assertFixtureExists();
  const argumentsList = process.argv.slice(2);
  const shouldUpdateContracts =
    argumentsList.length === 1 && argumentsList[0] === "--update-contracts";
  if (argumentsList.length > 0 && !shouldUpdateContracts) {
    console.error("Usage: node scripts/smoke-packed-cli-install.ts [--update-contracts]");
    process.exit(1);
  }
  if (!fs.existsSync(CLI_HELP_SNAPSHOT_PATH) && !shouldUpdateContracts) {
    console.error(`Missing ${path.relative(REPOSITORY_ROOT, CLI_HELP_SNAPSHOT_PATH)}.`);
    process.exit(1);
  }
  if (!fs.existsSync(PACKED_ENTRY_SNAPSHOT_PATH)) {
    console.error(`Missing ${path.relative(REPOSITORY_ROOT, PACKED_ENTRY_SNAPSHOT_PATH)}.`);
    process.exit(1);
  }

  const packedSnapshot = readJson<PackedPublicEntryPointSnapshot>(PACKED_ENTRY_SNAPSHOT_PATH);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-packed-cli-"));
  const packDirectory = path.join(temporaryDirectory, "pack");
  const installDirectory = path.join(temporaryDirectory, "install");

  try {
    fs.mkdirSync(packDirectory);
    fs.mkdirSync(installDirectory);
    fs.writeFileSync(
      path.join(installDirectory, "package.json"),
      `${JSON.stringify({ name: "react-doctor-packed-cli-smoke", private: true }, null, 2)}\n`,
    );

    // Pack the CLI together with every public package:
    // changesets version-bumps and publishes them as a pinned set, so
    // installing the tarballs mirrors what a release ships. The CLI keeps
    // `oxlint-plugin-react-doctor` and `deslop-js` external (neverBundle —
    // both wrap native binaries), so installing only the CLI tarball would
    // resolve them from the registry and reject any PR before their matching
    // versions are published (e.g. a workspace-locked `deslop-js@0.5.x` that
    // npm has never seen).
    runCommand({
      command: "pnpm",
      args: [
        ...packedSnapshot.filePolicies.flatMap(({ packageName }) => ["--filter", packageName]),
        "pack",
        "--pack-destination",
        packDirectory,
      ],
      cwd: REPOSITORY_ROOT,
      needsShell: process.platform === "win32",
    });

    const tarballs = fs.readdirSync(packDirectory).filter((fileName) => fileName.endsWith(".tgz"));
    if (tarballs.length !== packedSnapshot.filePolicies.length) {
      console.error(
        `Expected ${packedSnapshot.filePolicies.length} packed tarballs in ${packDirectory}, found ${tarballs.length}.`,
      );
      process.exit(1);
    }
    const tarballPaths = tarballs.map((tarball) => path.join(packDirectory, tarball));

    runCommand({
      command: "npm",
      args: ["install", "--omit=dev", ...tarballPaths],
      cwd: installDirectory,
      needsShell: process.platform === "win32",
    });

    const installedPackages = collectInstalledPackageNames(
      path.join(installDirectory, "node_modules"),
    );
    for (const filePolicy of packedSnapshot.filePolicies) {
      const packageDirectory = path.join(installDirectory, "node_modules", filePolicy.packageName);
      if (!fs.existsSync(packageDirectory)) {
        console.error(`Packed install is missing ${filePolicy.packageName}.`);
        process.exit(1);
      }
      assertPackedFilePolicy(packageDirectory, filePolicy);
      assertPackedBins(packageDirectory);
    }
    const forbiddenPackages = FORBIDDEN_INSTALLED_PACKAGES.filter((packageName) =>
      installedPackages.has(packageName),
    );
    if (forbiddenPackages.length > 0) {
      console.error(
        `Packed install unexpectedly installed forbidden package(s): ${forbiddenPackages.join(", ")}`,
      );
      process.exit(1);
    }

    assertPackedEntryFiles(installDirectory, packedSnapshot.entries);
    const currentEntryContracts = captureRuntimeEntryContracts(
      installDirectory,
      packedSnapshot.entries,
    );
    if (shouldUpdateContracts) {
      writeJson(PACKED_ENTRY_SNAPSHOT_PATH, {
        ...packedSnapshot,
        entries: currentEntryContracts,
      });
    } else if (!isDeepStrictEqual(currentEntryContracts, packedSnapshot.entries)) {
      console.error("Packed runtime export key drift detected.");
      console.error("Expected:", JSON.stringify(packedSnapshot.entries, null, 2));
      console.error("Received:", JSON.stringify(currentEntryContracts, null, 2));
      process.exit(1);
    }

    const binaryPath = path.join(
      installDirectory,
      "node_modules",
      "react-doctor",
      "bin",
      "react-doctor.js",
    );
    const versionResult = runCommand({
      command: process.execPath,
      args: [binaryPath, "--version"],
      cwd: installDirectory,
    });
    const version = versionResult.stdout.trim();
    if (version === "" || version === "0.0.0") {
      console.error(`Installed CLI version is missing or invalid: "${version}"`);
      process.exit(1);
    }

    const deslopBinaryPath = path.join(
      installDirectory,
      "node_modules",
      "deslop-cli",
      "dist",
      "cli.mjs",
    );
    runCommand({
      command: process.execPath,
      args: [deslopBinaryPath, "--help"],
      cwd: installDirectory,
    });

    const cliModulePath = path.join(
      installDirectory,
      "node_modules",
      "react-doctor",
      "dist",
      "cli.js",
    );
    const cliHelp = captureCliHelpSnapshot(cliModulePath, version);
    assertHelpCommandCoverage(cliHelp.rawOutputByName);
    if (shouldUpdateContracts) {
      writeJson(CLI_HELP_SNAPSHOT_PATH, cliHelp.snapshot);
    } else {
      const expectedCliHelp = readJson<ReadonlyArray<CliHelpSnapshotEntry>>(CLI_HELP_SNAPSHOT_PATH);
      if (!isDeepStrictEqual(cliHelp.snapshot, expectedCliHelp)) {
        console.error("Packed CLI help contract drift detected.");
        console.error("Run the packed smoke with --update-contracts after reviewing the change.");
        process.exit(1);
      }
    }

    const scanResult = runCommand({
      command: process.execPath,
      args: [
        binaryPath,
        FIXTURE_DIRECTORY,
        "--no-score",
        "--no-dead-code",
        "--blocking",
        "none",
        "--json",
      ],
      cwd: installDirectory,
      allowedStatuses: [0, 1],
    });

    const decodeJsonReport = Schema.decodeUnknownSync(JsonReport);
    let decoded: ReturnType<typeof decodeJsonReport>;
    try {
      decoded = decodeJsonReport(JSON.parse(scanResult.stdout));
    } catch (cause) {
      console.error("Installed CLI did not produce a schema-valid JsonReport.");
      console.error("stdout:", scanResult.stdout.slice(0, 2_000));
      console.error("cause:", cause);
      process.exit(1);
    }

    console.log(
      `Packed install smoke OK: version=${version} diagnostics=${decoded.diagnostics.length} entries=${currentEntryContracts.length} help=${cliHelp.snapshot.length} forbiddenPackages=0`,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
