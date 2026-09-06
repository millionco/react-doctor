import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateReport } from "../../.agents/skills/run-parity/scripts/compare-parity.mjs";
import { resolveBindingPackageName } from "../../native/oxlint/npm/react-doctor-rust/bin/resolve-native-binding.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readOption = (name) => {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = process.argv[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};
const registryPackage = readOption("--package");
const configuredTarballsDirectory = readOption("--tarballs");
const registryPackageMatch =
  registryPackage === null
    ? null
    : registryPackage.match(/^react-doctor-rust@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
if (registryPackage !== null && registryPackageMatch === null) {
  throw new Error("--package must be an exact react-doctor-rust@<semver> registry package");
}
if (registryPackageMatch?.[1] === "0.0.0") {
  throw new Error("--package must identify a published non-placeholder version");
}
if (registryPackage !== null && configuredTarballsDirectory !== null) {
  throw new Error("--package and --tarballs cannot be combined");
}
const bindingPackageName = resolveBindingPackageName();
const selectInstallPackages = () => {
  if (registryPackage !== null) return [registryPackage];

  const tarballsDirectory = path.resolve(
    configuredTarballsDirectory ?? path.join(repositoryRoot, "dist", "react-doctor-rust-tarballs"),
  );
  const tarballNames = fs
    .readdirSync(tarballsDirectory)
    .filter((fileName) => fileName.endsWith(".tgz"));
  const checksumLines = fs
    .readFileSync(path.join(tarballsDirectory, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n");
  for (const checksumLine of checksumLines) {
    const [expectedChecksum, fileName] = checksumLine.split(/\s+/, 2);
    const actualChecksum = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(tarballsDirectory, fileName)))
      .digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`${fileName} SHA-256 mismatch`);
    }
  }
  const findTarball = (packageName) => {
    const escapedPackageName = packageName
      .replace(/^@/, "")
      .replaceAll("/", "-")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tarballPattern = new RegExp(`^${escapedPackageName}-\\d`);
    const matches = tarballNames.filter((fileName) => tarballPattern.test(fileName));
    if (matches.length !== 1) {
      throw new Error(
        `Expected one ${packageName} tarball, received ${matches.join(", ") || "none"}`,
      );
    }
    return path.join(tarballsDirectory, matches[0]);
  };
  return [
    findTarball("react-doctor-rust"),
    findTarball(bindingPackageName),
    findTarball("react-doctor"),
    findTarball("oxlint-plugin-react-doctor"),
  ];
};
const selectedInstallPackages = selectInstallPackages();
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rust-smoke-"));
const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, {
    cwd: options.cwd ?? temporaryDirectory,
    env: { ...process.env, REACT_DOCTOR_NO_TELEMETRY: "1", ...options.env },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (!(options.allowedStatuses ?? [0]).includes(result.status)) {
    throw new Error(
      `${command} ${argumentsList.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
};

try {
  fs.writeFileSync(
    path.join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ name: "react-doctor-rust-smoke", private: true })}\n`,
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    ...selectedInstallPackages,
  ]);
  const installedBindingManifest = path.join(
    temporaryDirectory,
    "node_modules",
    bindingPackageName,
    "package.json",
  );
  if (!fs.existsSync(installedBindingManifest)) {
    throw new Error(`Installed package is missing ${bindingPackageName}`);
  }
  const launcherManifest = JSON.parse(
    fs.readFileSync(
      path.join(temporaryDirectory, "node_modules", "react-doctor-rust", "package.json"),
      "utf8",
    ),
  );
  const bindingManifest = JSON.parse(fs.readFileSync(installedBindingManifest, "utf8"));
  if (
    registryPackage === null &&
    (launcherManifest.private !== true || bindingManifest.private !== true)
  ) {
    throw new Error("Packed native packages must remain private in CI");
  }
  if (
    registryPackage !== null &&
    (launcherManifest.private === true || bindingManifest.private === true)
  ) {
    throw new Error("Published native packages must not be private");
  }
  if (registryPackageMatch !== null && launcherManifest.version !== registryPackageMatch[1]) {
    throw new Error(
      `Installed react-doctor-rust@${launcherManifest.version} does not match ${registryPackage}`,
    );
  }
  if (launcherManifest.optionalDependencies?.[bindingPackageName] !== launcherManifest.version) {
    throw new Error(
      `Packed react-doctor-rust does not select ${bindingPackageName}@${launcherManifest.version}`,
    );
  }
  if (bindingManifest.version !== launcherManifest.version) {
    throw new Error(
      `Packed ${bindingPackageName}@${bindingManifest.version} does not match react-doctor-rust@${launcherManifest.version}`,
    );
  }
  const binaryPath = path.join(
    temporaryDirectory,
    "node_modules",
    "react-doctor-rust",
    "bin",
    "react-doctor-rust.js",
  );
  const version = run(process.execPath, [binaryPath, "--version"]).stdout.trim();
  if (version === "" || version === "0.0.0") {
    throw new Error(
      `Installed react-doctor-rust reported invalid version ${JSON.stringify(version)}`,
    );
  }

  const fixtureDirectory = path.join(temporaryDirectory, "fixture");
  fs.mkdirSync(path.join(fixtureDirectory, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDirectory, "package.json"),
    `${JSON.stringify({ name: "fixture", private: true, main: "src/app.jsx", dependencies: { react: "19.2.5" } })}\n`,
  );
  fs.writeFileSync(
    path.join(fixtureDirectory, "doctor.config.json"),
    JSON.stringify({
      rules: {
        "react-doctor/unused-export": "warn",
        "react-doctor/duplicate-jsx-subtree": "warn",
      },
    }),
  );
  fs.writeFileSync(
    path.join(fixtureDirectory, "src", "app.jsx"),
    'import { usedSmokeValue } from "./smoke-values.js";\nexport const App = () => <div id={usedSmokeValue} id="second" />;\n',
  );
  fs.writeFileSync(
    path.join(fixtureDirectory, "src", "smoke-values.js"),
    'export const usedSmokeValue = "first";\nexport const unusedSmokeValue = "second";\n',
  );
  const migrationsDirectory = path.join(fixtureDirectory, "supabase", "migrations");
  fs.mkdirSync(migrationsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(migrationsDirectory, "001_smoke.sql"),
    "create table smoke_entries (id uuid primary key);\n",
  );
  const scanArguments = [
    binaryPath,
    fixtureDirectory,
    "--no-score",
    "--no-cache",
    "--no-parallel",
    "--diff",
    "false",
    "--blocking",
    "none",
    "--json",
  ];
  const scanResult = run(process.execPath, scanArguments);
  const report = JSON.parse(scanResult.stdout);
  const reportError = validateReport(report);
  if (report.schemaVersion !== 3 || report.mode !== "full" || reportError !== null) {
    throw new Error(
      `Packed native CLI returned an invalid or incomplete v3 report: ${reportError}\n${scanResult.stdout}`,
    );
  }
  for (const expectedRule of [
    "jsx-no-duplicate-props",
    "unused-export",
    "supabase-table-missing-rls",
  ]) {
    if (!report.diagnostics.some((diagnostic) => diagnostic.rule === expectedRule)) {
      throw new Error(`Packed native CLI did not report ${expectedRule}: ${scanResult.stdout}`);
    }
  }

  const assertFailure = (argumentsList, expectedMessage, options = {}) => {
    const result = run(process.execPath, argumentsList, {
      allowedStatuses: [1],
      env: options.env,
    });
    if (
      expectedMessage !== undefined &&
      !`${result.stdout}\n${result.stderr}`.includes(expectedMessage)
    ) {
      throw new Error(
        `Expected native failure ${JSON.stringify(expectedMessage)}\n${result.stdout}\n${result.stderr}`,
      );
    }
    if (options.expectedSkippedCheck !== undefined) {
      const failureReport = JSON.parse(result.stdout);
      const [failedProject] = failureReport.projects ?? [];
      if (
        failureReport.schemaVersion !== 3 ||
        failureReport.mode !== "full" ||
        failureReport.projects?.length !== 1 ||
        failedProject?.complete !== false ||
        !failedProject.skippedChecks?.includes(options.expectedSkippedCheck) ||
        typeof failedProject.skippedCheckReasons?.[options.expectedSkippedCheck] !== "string" ||
        failedProject.skippedCheckReasons[options.expectedSkippedCheck].trim() === "" ||
        validateReport(failureReport) !== "1 project report is incomplete"
      ) {
        throw new Error(
          `Native failure did not report incomplete ${options.expectedSkippedCheck} analysis: ${result.stdout}`,
        );
      }
    }
  };
  const bindingDirectory = path.dirname(installedBindingManifest);
  const missingBindingDirectory = `${bindingDirectory}-missing`;
  fs.renameSync(bindingDirectory, missingBindingDirectory);
  try {
    assertFailure(
      [binaryPath, "--version"],
      `The native package ${bindingPackageName} is missing.`,
    );
  } finally {
    fs.renameSync(missingBindingDirectory, bindingDirectory);
  }
  const originalBindingManifest = fs.readFileSync(installedBindingManifest, "utf8");
  fs.writeFileSync(
    installedBindingManifest,
    JSON.stringify({
      ...bindingManifest,
      version: `${bindingManifest.version}-native-smoke-mismatch`,
    }),
  );
  try {
    assertFailure([binaryPath, "--version"], "is incompatible with react-doctor-rust@");
  } finally {
    fs.writeFileSync(installedBindingManifest, originalBindingManifest);
  }
  const preloadPath = path.join(temporaryDirectory, "native-smoke-failure.mjs");
  const injectedFailures = [
    {
      exportName: "scanReactDoctorFile",
      replacement: "undefined",
      argumentsList: [binaryPath, "--version"],
      expectedMessage: "missing scanReactDoctorFile().",
    },
    {
      exportName: "scanReactDoctorFile",
      replacement: "() => 'not json'",
      argumentsList: scanArguments,
      expectedSkippedCheck: "security-scan",
    },
    {
      exportName: "analyzeReactDoctorProjectGraph",
      replacement: "() => 'not json'",
      argumentsList: scanArguments,
      expectedSkippedCheck: "dead-code",
    },
    {
      exportName: "analyzeReactDoctorDuplicateJsx",
      replacement: "() => '{}'",
      argumentsList: scanArguments,
      expectedSkippedCheck: "dead-code",
    },
  ];
  for (const failure of injectedFailures) {
    fs.writeFileSync(
      preloadPath,
      `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bindingPath = require.resolve(${JSON.stringify(bindingPackageName)});
const binding = require(bindingPath);
require.cache[bindingPath].exports = {
  ...binding,
  [${JSON.stringify(failure.exportName)}]: ${failure.replacement},
};
`,
    );
    assertFailure(failure.argumentsList, failure.expectedMessage, {
      expectedSkippedCheck: failure.expectedSkippedCheck,
      env: {
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preloadPath).href}`.trim(),
      },
    });
  }
  process.stdout.write(
    `react-doctor-rust ${registryPackage === null ? "packed" : "registry"} smoke passed on ${process.platform}-${process.arch}\n`,
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
