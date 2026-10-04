#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_MANAGER_LOCKFILES = [
  { name: "pnpm", lockfile: "pnpm-lock.yaml" },
  { name: "yarn", lockfile: "yarn.lock" },
  { name: "bun", lockfile: "bun.lockb" },
  { name: "bun", lockfile: "bun.lock" },
  { name: "npm", lockfile: "package-lock.json" },
];

const readPackageJson = (directory) => {
  const packageJsonPath = path.join(directory, "package.json");
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
};

const findNearestFileDirectory = (startDirectory, fileNames) => {
  let currentDirectory = path.resolve(startDirectory);
  while (true) {
    if (fileNames.some((fileName) => fs.existsSync(path.join(currentDirectory, fileName)))) {
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
};

const detectPackageManager = (projectRoot) => {
  let currentDirectory = path.resolve(projectRoot);
  while (true) {
    const packageJson = readPackageJson(currentDirectory);
    if (packageJson?.packageManager) {
      const packageManagerName = packageJson.packageManager.split("@")[0];
      if (["pnpm", "yarn", "bun", "npm"].includes(packageManagerName)) {
        return packageManagerName;
      }
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  const lockfileDirectory = findNearestFileDirectory(
    projectRoot,
    PACKAGE_MANAGER_LOCKFILES.map((item) => item.lockfile),
  );
  const matchedLockfile = PACKAGE_MANAGER_LOCKFILES.find(
    (item) =>
      lockfileDirectory !== null && fs.existsSync(path.join(lockfileDirectory, item.lockfile)),
  );
  return matchedLockfile?.name ?? "npm";
};

const hasReactDoctorInstalled = (projectRoot) => {
  const packageJson = readPackageJson(projectRoot);
  if (!packageJson) return false;
  
  const deps = packageJson.dependencies || {};
  const devDeps = packageJson.devDependencies || {};
  return Boolean(deps["react-doctor"] || devDeps["react-doctor"]);
};

const writeOutputs = (outputs) => {
  const rendered = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (outputPath) {
    fs.appendFileSync(outputPath, `${rendered}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
};

const main = () => {
  const projectDirectory = process.argv[2] || ".";
  const packageManager = detectPackageManager(projectDirectory);
  const hasInstalled = hasReactDoctorInstalled(projectDirectory);
  
  writeOutputs({
    "package-manager": packageManager,
    "has-installed": hasInstalled ? "true" : "false",
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { detectPackageManager, hasReactDoctorInstalled };
