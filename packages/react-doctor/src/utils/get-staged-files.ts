import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SOURCE_FILE_PATTERN } from "../constants.js";

const getStagedFilePaths = (directory: string): string[] => {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR --relative", {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const readStagedContent = (directory: string, relativePath: string): string | null => {
  try {
    return execSync(`git show ":${relativePath}"`, {
      cwd: directory,
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
  } catch {
    return null;
  }
};

interface StagedSnapshot {
  tempDirectory: string;
  stagedFiles: string[];
  cleanup: () => void;
}

export const getStagedSourceFiles = (directory: string): string[] =>
  getStagedFilePaths(directory).filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));

export const materializeStagedFiles = (
  directory: string,
  stagedFiles: string[],
  tempDirectory: string,
): StagedSnapshot => {
  const materializedFiles: string[] = [];

  for (const relativePath of stagedFiles) {
    const content = readStagedContent(directory, relativePath);
    if (content === null) continue;

    const targetPath = path.join(tempDirectory, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
    materializedFiles.push(relativePath);
  }

  const configFiles = ["tsconfig.json", "package.json"];
  for (const configFile of configFiles) {
    const sourcePath = path.join(directory, configFile);
    const targetPath = path.join(tempDirectory, configFile);
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.cpSync(sourcePath, targetPath);
    }
  }

  return {
    tempDirectory,
    stagedFiles: materializedFiles,
    cleanup: () => {
      try {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      } catch {}
    },
  };
};
