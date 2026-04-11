import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GIT_SHOW_MAX_BUFFER_BYTES, SOURCE_FILE_PATTERN } from "../constants.js";

const getStagedFilePaths = (directory: string): string[] => {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--relative"],
    { cwd: directory, stdio: "pipe", maxBuffer: GIT_SHOW_MAX_BUFFER_BYTES },
  );
  if (result.error || result.status !== 0) return [];
  const output = result.stdout.toString().trim();
  if (!output) return [];
  return output.split("\n").filter(Boolean);
};

const readStagedContent = (directory: string, relativePath: string): string | null => {
  const result = spawnSync("git", ["show", `:${relativePath}`], {
    cwd: directory,
    stdio: "pipe",
    maxBuffer: GIT_SHOW_MAX_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.toString();
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

  const projectConfigFilenames = ["tsconfig.json", "package.json", "react-doctor.config.json"];
  for (const configFilename of projectConfigFilenames) {
    const sourcePath = path.join(directory, configFilename);
    const targetPath = path.join(tempDirectory, configFilename);
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
