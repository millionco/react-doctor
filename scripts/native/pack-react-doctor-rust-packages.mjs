import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readOption = (name) => {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = process.argv[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};
const packageDirectory = path.resolve(
  readOption("--packages") ?? path.join(repositoryRoot, "dist", "react-doctor-rust-npm"),
);
const tarballsDirectory = path.resolve(
  readOption("--output") ?? path.join(repositoryRoot, "dist", "react-doctor-rust-tarballs"),
);
if (!tarballsDirectory.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error(`Tarball output must stay inside ${repositoryRoot}: ${tarballsDirectory}`);
}

fs.rmSync(tarballsDirectory, { recursive: true, force: true });
fs.mkdirSync(tarballsDirectory, { recursive: true });
fs.copyFileSync(
  path.join(packageDirectory, "package-manifest.json"),
  path.join(tarballsDirectory, "package-manifest.json"),
);
const platformPackagesDirectory = path.join(packageDirectory, "platform-packages");
const nativePackageDirectories = [
  path.join(packageDirectory, "react-doctor-rust"),
  ...fs
    .readdirSync(platformPackagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(platformPackagesDirectory, entry.name))
    .sort(),
];
for (const nativePackageDirectory of nativePackageDirectories) {
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", tarballsDirectory], {
    cwd: nativePackageDirectory,
    stdio: "inherit",
  });
}
for (const workspacePackageDirectory of [
  path.join(repositoryRoot, "packages", "oxlint-plugin-react-doctor"),
  path.join(repositoryRoot, "packages", "react-doctor"),
]) {
  execFileSync("pnpm", ["pack", "--pack-destination", tarballsDirectory], {
    cwd: workspacePackageDirectory,
    stdio: "inherit",
  });
}

const tarballNames = fs
  .readdirSync(tarballsDirectory)
  .filter((fileName) => fileName.endsWith(".tgz"))
  .sort();
const checksumLines = tarballNames.map((tarballName) => {
  const checksum = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(tarballsDirectory, tarballName)))
    .digest("hex");
  return `${checksum}  ${tarballName}`;
});
fs.writeFileSync(path.join(tarballsDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
process.stdout.write(`Packed ${tarballNames.length} packages into ${tarballsDirectory}\n`);
