import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface CommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly allowedStatuses?: readonly number[];
  readonly needsShell?: boolean;
}

interface StringRecord {
  readonly [key: string]: unknown;
}

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_DIRECTORY = path.resolve(REPOSITORY_ROOT, "packages/core/tests/fixtures/basic-react");
const FORBIDDEN_INSTALLED_PACKAGES: readonly string[] = [
  "ini",
  "effect",
  "@effect/platform-node-shared",
];
const COMMAND_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

const isRecord = (value: unknown): value is StringRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const runCommand = (input: CommandInput) => {
  const result = spawnSync(input.command, [...input.args], {
    cwd: input.cwd,
    encoding: "utf-8",
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

// Pack the CLI together with its unbundled workspace dependencies:
// changesets version-bumps and publishes them as a pinned set, so installing
// the tarballs mirrors what a release ships. The CLI keeps
// `oxlint-plugin-react-doctor` and `deslop-js` external (neverBundle — both
// wrap native binaries), so installing only the CLI tarball would resolve them
// from the registry and reject any PR before their matching versions are
// published (e.g. a workspace-locked `deslop-js@0.5.x` that npm has never seen).
const packTarballs = (packDirectory: string): void => {
  fs.mkdirSync(packDirectory, { recursive: true });
  runCommand({
    command: "pnpm",
    args: [
      "--filter",
      "react-doctor",
      "--filter",
      "oxlint-plugin-react-doctor",
      "--filter",
      "deslop-js",
      "pack",
      "--pack-destination",
      packDirectory,
    ],
    cwd: REPOSITORY_ROOT,
    needsShell: process.platform === "win32",
  });
  assertTarballPaths(packDirectory);
};

const assertTarballPaths = (packDirectory: string): readonly string[] => {
  const tarballs = fs.readdirSync(packDirectory).filter((fileName) => fileName.endsWith(".tgz"));
  if (tarballs.length !== 3) {
    console.error(
      `Expected exactly three packed tarballs in ${packDirectory}, found ${tarballs.length}.`,
    );
    process.exit(1);
  }
  return tarballs.map((tarball) => path.join(packDirectory, tarball));
};

// Install the packed tarballs into a throwaway project and assert the published
// CLI installs cleanly, pulls no forbidden transitives, reports a real version,
// and emits a schema-valid JSON report. Split from packing so CI can pack once
// on Linux (the OS that builds the published bundle) and run this verify step on
// Windows/macOS against that exact artifact — the platform-divergent bundling a
// per-OS rebuild would introduce never ships, so testing a per-OS rebuild only
// produced false negatives.
const verifyTarballs = (packDirectory: string): void => {
  assertFixtureExists();
  const tarballPaths = assertTarballPaths(packDirectory);
  const installDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-packed-cli-"));

  try {
    fs.writeFileSync(
      path.join(installDirectory, "package.json"),
      `${JSON.stringify({ name: "react-doctor-packed-cli-smoke", private: true }, null, 2)}\n`,
    );

    runCommand({
      command: "npm",
      args: ["install", "--omit=dev", ...tarballPaths],
      cwd: installDirectory,
      needsShell: process.platform === "win32",
    });

    const installedPackages = collectInstalledPackageNames(
      path.join(installDirectory, "node_modules"),
    );
    const forbiddenPackages = FORBIDDEN_INSTALLED_PACKAGES.filter((packageName) =>
      installedPackages.has(packageName),
    );
    if (forbiddenPackages.length > 0) {
      console.error(
        `Packed install unexpectedly installed forbidden package(s): ${forbiddenPackages.join(", ")}`,
      );
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

    let decoded: ReturnType<typeof Schema.decodeUnknownSync<typeof JsonReport>>;
    try {
      decoded = Schema.decodeUnknownSync(JsonReport)(JSON.parse(scanResult.stdout));
    } catch (cause) {
      console.error("Installed CLI did not produce a schema-valid JsonReport.");
      console.error("stdout:", scanResult.stdout.slice(0, 2_000));
      console.error("cause:", cause);
      process.exit(1);
    }

    console.log(
      `Packed install smoke OK: version=${version} diagnostics=${decoded.diagnostics.length} forbiddenPackages=0`,
    );
  } finally {
    fs.rmSync(installDirectory, { recursive: true, force: true });
  }
};

const readDirectoryArgument = (flag: string): string | null => {
  const flagIndex = process.argv.indexOf(flag);
  if (flagIndex === -1) return null;
  const value = process.argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${flag} requires a directory path.`);
    process.exit(1);
  }
  return path.resolve(value);
};

const main = (): void => {
  // `--pack-only <dir>` packs the publishable tarballs for a CI artifact upload;
  // `--tarballs <dir>` verifies a previously packed set (the cross-OS leg). With
  // neither flag, pack and verify in one throwaway directory (local default).
  const packOnlyDirectory = readDirectoryArgument("--pack-only");
  if (packOnlyDirectory !== null) {
    packTarballs(packOnlyDirectory);
    console.log(`Packed CLI tarballs into ${packOnlyDirectory}`);
    return;
  }

  const tarballsDirectory = readDirectoryArgument("--tarballs");
  if (tarballsDirectory !== null) {
    verifyTarballs(tarballsDirectory);
    return;
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-packed-cli-"));
  try {
    packTarballs(temporaryDirectory);
    verifyTarballs(temporaryDirectory);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

main();
