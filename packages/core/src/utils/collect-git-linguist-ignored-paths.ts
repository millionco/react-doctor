import { execFile, spawnSync } from "node:child_process";
import { GIT_CHECK_ATTR_MAX_BUFFER_BYTES } from "../constants.js";

const LINGUIST_ATTRIBUTES = ["linguist-generated", "linguist-vendored"];
const DISABLED_ATTRIBUTE_VALUES = new Set(["unspecified", "unset", "false", "0", "off", "no"]);

const buildInput = (relativePaths: ReadonlyArray<string>): string =>
  `${relativePaths.join("\0")}\0`;

const parseIgnoredPaths = (output: string): ReadonlySet<string> => {
  const ignoredPaths = new Set<string>();
  const fields = output.split("\0");
  for (let fieldIndex = 0; fieldIndex + 2 < fields.length; fieldIndex += 3) {
    const filePath = fields[fieldIndex];
    const value = fields[fieldIndex + 2]?.toLowerCase();
    if (filePath && value && !DISABLED_ATTRIBUTE_VALUES.has(value)) {
      ignoredPaths.add(filePath);
    }
  }
  return ignoredPaths;
};

export const collectGitLinguistIgnoredPaths = (
  rootDirectory: string,
  relativePaths: ReadonlyArray<string>,
): ReadonlySet<string> => {
  if (relativePaths.length === 0) return new Set();
  const result = spawnSync("git", ["check-attr", "-z", "--stdin", ...LINGUIST_ATTRIBUTES], {
    cwd: rootDirectory,
    encoding: "utf-8",
    input: buildInput(relativePaths),
    maxBuffer: GIT_CHECK_ATTR_MAX_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) return new Set();
  return parseIgnoredPaths(result.stdout);
};

export const collectGitLinguistIgnoredPathsCooperative = (
  rootDirectory: string,
  relativePaths: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> => {
  if (relativePaths.length === 0) return Promise.resolve(new Set());
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = execFile(
      "git",
      ["check-attr", "-z", "--stdin", ...LINGUIST_ATTRIBUTES],
      {
        cwd: rootDirectory,
        encoding: "utf-8",
        killSignal: "SIGKILL",
        maxBuffer: GIT_CHECK_ATTR_MAX_BUFFER_BYTES,
        signal,
      },
      (error, stdout) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        resolve(error ? new Set() : parseIgnoredPaths(stdout));
      },
    );
    child.stdin?.end(buildInput(relativePaths));
  });
};
