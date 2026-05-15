import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OXLINT_RECOMMENDED_NODE_MAJOR } from "../constants.js";

interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

interface NodeResolution {
  binaryPath: string;
  isCurrentNode: boolean;
  version: string;
}

const parseNodeVersion = (versionString: string): NodeVersion => {
  const cleaned = versionString.replace(/^v/, "").trim();
  const [major = 0, minor = 0, patch = 0] = cleaned.split(".").map(Number);
  return { major, minor, patch };
};

const isNodeVersionCompatibleWithOxlint = ({ major, minor }: NodeVersion): boolean => {
  if (major === 20 && minor >= 19) return true;
  if (major === 22 && minor >= 12) return true;
  if (major > 22) return true;
  return false;
};

const isCurrentNodeCompatibleWithOxlint = (): boolean =>
  isNodeVersionCompatibleWithOxlint(parseNodeVersion(process.version));

const getNvmDirectory = (): string | null => {
  const envNvmDirectory = process.env.NVM_DIR;
  if (envNvmDirectory && existsSync(envNvmDirectory)) return envNvmDirectory;

  const defaultNvmDirectory = path.join(os.homedir(), ".nvm");
  if (existsSync(defaultNvmDirectory)) return defaultNvmDirectory;

  return null;
};

export const isNvmInstalled = (): boolean => getNvmDirectory() !== null;

const findCompatibleNvmBinary = (): string | null => {
  const nvmDirectory = getNvmDirectory();
  if (!nvmDirectory) return null;

  const versionsDirectory = path.join(nvmDirectory, "versions", "node");
  if (!existsSync(versionsDirectory)) return null;

  const compatibleVersions = readdirSync(versionsDirectory)
    .filter((directoryName) => directoryName.startsWith("v"))
    .map((directoryName) => ({ directoryName, ...parseNodeVersion(directoryName) }))
    .filter((version) => isNodeVersionCompatibleWithOxlint(version))
    .sort(
      (versionA, versionB) =>
        versionB.major - versionA.major ||
        versionB.minor - versionA.minor ||
        versionB.patch - versionA.patch,
    );

  if (compatibleVersions.length === 0) return null;

  const bestVersion = compatibleVersions[0];
  const binaryPath = path.join(versionsDirectory, bestVersion.directoryName, "bin", "node");
  return existsSync(binaryPath) ? binaryPath : null;
};

const getNodeVersionFromBinary = (binaryPath: string): string | null => {
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf-8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.toString().trim();
};

export const installNodeViaNvm = (): boolean => {
  const nvmDirectory = getNvmDirectory();
  if (!nvmDirectory) return false;

  const nvmScript = path.join(nvmDirectory, "nvm.sh");
  if (!existsSync(nvmScript)) return false;

  const result = spawnSync("bash", ["-c", '. "$NVM_SCRIPT" && nvm install "$NODE_MAJOR"'], {
    stdio: "inherit",
    env: {
      ...process.env,
      NVM_SCRIPT: nvmScript,
      NODE_MAJOR: String(OXLINT_RECOMMENDED_NODE_MAJOR),
    },
  });
  if (result.error || result.status !== 0) return false;
  return findCompatibleNvmBinary() !== null;
};

export const resolveNodeForOxlint = (): NodeResolution | null => {
  if (isCurrentNodeCompatibleWithOxlint()) {
    return {
      binaryPath: process.execPath,
      isCurrentNode: true,
      version: process.version,
    };
  }

  const nvmBinaryPath = findCompatibleNvmBinary();
  if (!nvmBinaryPath) return null;

  const version = getNodeVersionFromBinary(nvmBinaryPath);
  if (!version) return null;

  return { binaryPath: nvmBinaryPath, isCurrentNode: false, version };
};
