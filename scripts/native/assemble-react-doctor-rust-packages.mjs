import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNativeSourceSha256 } from "./utils/compute-native-source-sha256.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageTemplateDirectory = path.join(
  repositoryRoot,
  "native",
  "oxlint",
  "npm",
  "react-doctor-rust",
);
const packageTemplatePath = path.join(packageTemplateDirectory, "package.json");
const oxcLicensePath = path.join(repositoryRoot, "native", "oxlint", "npm", "OXC-LICENSE");
const patchPath = path.join(repositoryRoot, "native", "oxlint", "react-doctor.patch");
const reactDoctorLicensePath = path.join(repositoryRoot, "LICENSE");
const expectedTargets = [
  { suffix: "darwin-arm64", directory: "darwin-arm64" },
  { suffix: "darwin-x64", directory: "darwin-x64" },
  { suffix: "linux-arm64-gnu", directory: "linux-arm64-gnu" },
  { suffix: "linux-x64-gnu", directory: "linux-x64-gnu" },
  { suffix: "win32-x64-msvc", directory: "win32-x64-msvc" },
];

const readOption = (name) => {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = process.argv[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};

const artifactsDirectory = path.resolve(
  readOption("--artifacts") ?? path.join(repositoryRoot, "dist", "native-oxlint-all"),
);
const outputDirectory = path.resolve(
  readOption("--output") ?? path.join(repositoryRoot, "dist", "react-doctor-rust-npm"),
);
const configuredPackageVersion = readOption("--version");
const configuredReactDoctorVersion = readOption("--react-doctor-version");
const packageVersion = configuredPackageVersion ?? "0.0.0";
const reactDoctorManifest = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "packages", "react-doctor", "package.json"), "utf8"),
);
const reactDoctorVersion = configuredReactDoctorVersion ?? reactDoctorManifest.version;

if (!outputDirectory.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error(`Package output must stay inside ${repositoryRoot}: ${outputDirectory}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error(`Invalid package version: ${packageVersion}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(reactDoctorVersion)) {
  throw new Error(`Invalid react-doctor version: ${reactDoctorVersion}`);
}
if (packageVersion !== "0.0.0" && configuredReactDoctorVersion === null) {
  throw new Error(
    "Release assemblies require --react-doctor-version for a published react-doctor build with native-required support.",
  );
}
if (!fs.existsSync(artifactsDirectory)) {
  throw new Error(`Native artifacts directory does not exist: ${artifactsDirectory}`);
}

const collectFiles = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
};

const filesByName = new Map();
for (const filePath of collectFiles(artifactsDirectory)) {
  const fileName = path.basename(filePath);
  const existingPath = filesByName.get(fileName);
  if (existingPath !== undefined) {
    throw new Error(`Duplicate native artifact ${fileName}: ${existingPath}, ${filePath}`);
  }
  filesByName.set(fileName, filePath);
}
const expectedArtifactNames = new Set(
  expectedTargets.flatMap(({ suffix }) => {
    const bindingFileName = `oxlint-react-doctor.${suffix}.node`;
    return [bindingFileName, `${bindingFileName}.json`];
  }),
);
const unexpectedArtifactNames = [...filesByName.keys()].filter(
  (fileName) =>
    (fileName.endsWith(".node") || fileName.endsWith(".node.json")) &&
    !expectedArtifactNames.has(fileName),
);
if (unexpectedArtifactNames.length > 0) {
  throw new Error(`Unexpected native artifacts: ${unexpectedArtifactNames.sort().join(", ")}`);
}

const sha256 = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const sourceSha256 = computeNativeSourceSha256(repositoryRoot);
const targetArtifacts = expectedTargets.map((target) => {
  const bindingFileName = `oxlint-react-doctor.${target.suffix}.node`;
  const metadataFileName = `${bindingFileName}.json`;
  const bindingPath = filesByName.get(bindingFileName);
  const metadataPath = filesByName.get(metadataFileName);
  if (bindingPath === undefined || metadataPath === undefined) {
    throw new Error(`Missing ${bindingFileName} or ${metadataFileName}`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (metadata.sourceSha256 !== sourceSha256) {
    throw new Error(
      `${metadataFileName} source SHA-256 mismatch: expected ${sourceSha256}, received ${metadata.sourceSha256}. Rebuild this target from the current native sources.`,
    );
  }
  if (metadata.bindingFile !== bindingFileName) {
    throw new Error(`${metadataFileName} identifies ${metadata.bindingFile}`);
  }
  const bindingSha256 = sha256(bindingPath);
  if (metadata.bindingSha256 !== bindingSha256) {
    throw new Error(
      `${bindingFileName} SHA-256 mismatch: expected ${metadata.bindingSha256}, received ${bindingSha256}`,
    );
  }
  return { ...target, bindingFileName, bindingPath, metadataFileName, metadataPath, metadata };
});

const firstMetadata = targetArtifacts[0].metadata;
const patchSha256 = sha256(patchPath);
if (firstMetadata.patchSha256 !== patchSha256) {
  throw new Error(
    `Native artifact patch SHA-256 mismatch: expected ${patchSha256}, received ${firstMetadata.patchSha256}`,
  );
}
for (const targetArtifact of targetArtifacts.slice(1)) {
  for (const metadataKey of [
    "upstreamRepository",
    "upstreamTag",
    "upstreamCommit",
    "oxlintVersion",
    "rustToolchain",
    "patchSha256",
  ]) {
    if (targetArtifact.metadata[metadataKey] !== firstMetadata[metadataKey]) {
      throw new Error(
        `${targetArtifact.metadataFileName} disagrees on ${metadataKey}: ${targetArtifact.metadata[metadataKey]} !== ${firstMetadata[metadataKey]}`,
      );
    }
  }
  for (const ruleKey of ["nativeRules", "nativeScanRules", "nativeProjectRules"]) {
    if (
      JSON.stringify(targetArtifact.metadata[ruleKey]) !== JSON.stringify(firstMetadata[ruleKey])
    ) {
      throw new Error(`${targetArtifact.metadataFileName} disagrees on ${ruleKey}`);
    }
  }
}

const requireFromScript = createRequire(import.meta.url);
const napiCliPath = path.join(path.dirname(requireFromScript.resolve("@napi-rs/cli")), "cli.js");

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
const flattenedArtifactsDirectory = path.join(outputDirectory, "artifacts");
const platformPackagesDirectory = path.join(outputDirectory, "platform-packages");
const launcherPackageDirectory = path.join(outputDirectory, "react-doctor-rust");
fs.mkdirSync(flattenedArtifactsDirectory, { recursive: true });
fs.mkdirSync(path.join(launcherPackageDirectory, "bin"), { recursive: true });
for (const fileName of ["react-doctor-rust.js", "resolve-native-binding.js"]) {
  fs.copyFileSync(
    path.join(packageTemplateDirectory, "bin", fileName),
    path.join(launcherPackageDirectory, "bin", fileName),
  );
}
fs.copyFileSync(
  path.join(packageTemplateDirectory, "README.md"),
  path.join(launcherPackageDirectory, "README.md"),
);
fs.copyFileSync(reactDoctorLicensePath, path.join(launcherPackageDirectory, "LICENSE"));
const launcherManifest = JSON.parse(fs.readFileSync(packageTemplatePath, "utf8"));
launcherManifest.version = packageVersion;
launcherManifest.dependencies["react-doctor"] = reactDoctorVersion;
fs.writeFileSync(
  path.join(launcherPackageDirectory, "package.json"),
  `${JSON.stringify(launcherManifest, null, 2)}\n`,
);
for (const targetArtifact of targetArtifacts) {
  fs.copyFileSync(
    targetArtifact.bindingPath,
    path.join(flattenedArtifactsDirectory, targetArtifact.bindingFileName),
  );
}

const runNapi = (argumentsList) =>
  execFileSync(process.execPath, [napiCliPath, ...argumentsList], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
runNapi([
  "create-npm-dirs",
  "--package-json-path",
  path.join(launcherPackageDirectory, "package.json"),
  "--npm-dir",
  platformPackagesDirectory,
]);
runNapi([
  "artifacts",
  "--package-json-path",
  path.join(launcherPackageDirectory, "package.json"),
  "--output-dir",
  flattenedArtifactsDirectory,
  "--npm-dir",
  platformPackagesDirectory,
]);

const optionalDependencies = {};
for (const targetArtifact of targetArtifacts) {
  const platformPackageDirectory = path.join(platformPackagesDirectory, targetArtifact.directory);
  const platformManifestPath = path.join(platformPackageDirectory, "package.json");
  const platformManifest = JSON.parse(fs.readFileSync(platformManifestPath, "utf8"));
  platformManifest.private = true;
  platformManifest.version = packageVersion;
  platformManifest.files.push(targetArtifact.metadataFileName, "LICENSE", "OXC-LICENSE");
  fs.writeFileSync(platformManifestPath, `${JSON.stringify(platformManifest, null, 2)}\n`);
  fs.copyFileSync(
    targetArtifact.metadataPath,
    path.join(platformPackageDirectory, targetArtifact.metadataFileName),
  );
  fs.copyFileSync(reactDoctorLicensePath, path.join(platformPackageDirectory, "LICENSE"));
  fs.copyFileSync(oxcLicensePath, path.join(platformPackageDirectory, "OXC-LICENSE"));
  optionalDependencies[platformManifest.name] = packageVersion;
  fs.rmSync(path.join(launcherPackageDirectory, targetArtifact.bindingFileName), { force: true });
}

launcherManifest.optionalDependencies = optionalDependencies;
fs.writeFileSync(
  path.join(launcherPackageDirectory, "package.json"),
  `${JSON.stringify(launcherManifest, null, 2)}\n`,
);

const packageManifest = {
  packageVersion,
  reactDoctorVersion,
  upstreamRepository: firstMetadata.upstreamRepository,
  upstreamTag: firstMetadata.upstreamTag,
  upstreamCommit: firstMetadata.upstreamCommit,
  oxlintVersion: firstMetadata.oxlintVersion,
  rustToolchain: firstMetadata.rustToolchain,
  patchSha256: firstMetadata.patchSha256,
  sourceSha256,
  targets: targetArtifacts.map((targetArtifact) => ({
    suffix: targetArtifact.suffix,
    bindingFile: targetArtifact.bindingFileName,
    bindingSha256: targetArtifact.metadata.bindingSha256,
  })),
};
fs.writeFileSync(
  path.join(outputDirectory, "package-manifest.json"),
  `${JSON.stringify(packageManifest, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(outputDirectory, "SHA256SUMS"),
  `${targetArtifacts
    .map(
      (targetArtifact) =>
        `${targetArtifact.metadata.bindingSha256}  platform-packages/${targetArtifact.directory}/${targetArtifact.bindingFileName}`,
    )
    .join("\n")}\n`,
);
fs.rmSync(flattenedArtifactsDirectory, { recursive: true, force: true });
process.stdout.write(
  `Prepared react-doctor-rust ${packageVersion} for ${targetArtifacts.length} platforms in ${outputDirectory}\n`,
);
