import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromScript = createRequire(import.meta.url);
const nativeDirectory = path.join(repositoryRoot, "native", "oxlint");
const upstream = JSON.parse(fs.readFileSync(path.join(nativeDirectory, "upstream.json"), "utf8"));
const patchPath = path.join(nativeDirectory, "react-doctor.patch");

const argumentsList = process.argv.slice(2);
const readOption = (name) => {
  const optionIndex = argumentsList.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = argumentsList[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};

const sourcePath = readOption("--source");
const outputDirectory = path.resolve(
  readOption("--output") ?? path.join(repositoryRoot, "dist", "native-oxlint"),
);
const shouldCheckOnly = argumentsList.includes("--check-only");
const shouldUseAllocator = !argumentsList.includes("--no-allocator");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxc-"));
const checkoutDirectory = path.join(temporaryDirectory, "oxc");

const run = (command, commandArguments, options = {}) =>
  execFileSync(command, commandArguments, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });

try {
  if (sourcePath) {
    run("git", ["clone", "--no-checkout", path.resolve(sourcePath), checkoutDirectory]);
  } else {
    run("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "--branch",
      upstream.tag,
      "--depth=1",
      upstream.repository,
      checkoutDirectory,
    ]);
  }

  run("git", ["checkout", "--detach", upstream.commit], { cwd: checkoutDirectory });
  const resolvedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkoutDirectory,
    encoding: "utf8",
  }).trim();
  if (resolvedCommit !== upstream.commit) {
    throw new Error(`expected upstream commit ${upstream.commit}, received ${resolvedCommit}`);
  }

  run("git", ["apply", "--check", patchPath], { cwd: checkoutDirectory });
  if (shouldCheckOnly) {
    process.stdout.write(`Patch applies to ${upstream.tag} (${upstream.commit}).\n`);
    process.exitCode = 0;
  } else {
    run("git", ["apply", patchPath], { cwd: checkoutDirectory });
    const targetDirectory = path.resolve(
      process.env.CARGO_TARGET_DIR ?? path.join(temporaryDirectory, "target"),
    );
    const cargoArguments = ["build", "--locked", "-p", "oxlint", "--release"];
    if (shouldUseAllocator) cargoArguments.push("--features", "allocator");
    run("cargo", cargoArguments, {
      cwd: checkoutDirectory,
      env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
    });

    const libraryName =
      process.platform === "win32"
        ? "oxlint.dll"
        : process.platform === "darwin"
          ? "liboxlint.dylib"
          : "liboxlint.so";
    const platformSuffix =
      process.platform === "linux"
        ? `${process.platform}-${process.arch}-gnu`
        : `${process.platform}-${process.arch}`;
    const bindingFileName = `oxlint-react-doctor.${platformSuffix}.node`;
    const builtLibraryPath = path.join(targetDirectory, "release", libraryName);
    const outputBindingPath = path.join(outputDirectory, bindingFileName);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.copyFileSync(builtLibraryPath, outputBindingPath);
    const nativeBinding = requireFromScript(outputBindingPath);
    if (typeof nativeBinding.lint !== "function") {
      throw new Error(`built binding does not export lint: ${outputBindingPath}`);
    }

    const sha256 = (filePath) =>
      crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    fs.writeFileSync(
      path.join(outputDirectory, `${bindingFileName}.json`),
      `${JSON.stringify(
        {
          upstreamRepository: upstream.repository,
          upstreamTag: upstream.tag,
          upstreamCommit: upstream.commit,
          oxlintVersion: upstream.oxlintVersion,
          rustToolchain: upstream.rustToolchain,
          nativeRules: upstream.nativeRules,
          bindingFile: bindingFileName,
          bindingSha256: sha256(outputBindingPath),
          patchSha256: sha256(patchPath),
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`Built ${outputBindingPath}\n`);
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
