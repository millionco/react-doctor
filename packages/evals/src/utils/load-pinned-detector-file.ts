import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SOL_REVIEW_MAX_RULE_CHARACTERS, PINNED_REPOSITORY_REF_PATTERN } from "../constants.js";
import { sourcePath } from "../prepare-classification.js";

interface LoadPinnedDetectorFileInput {
  detectorCommit: string;
  filePath: string;
}

const executeFile = promisify(execFile);

export const loadPinnedDetectorFile = async ({
  detectorCommit,
  filePath,
}: LoadPinnedDetectorFileInput): Promise<string> => {
  const safePath = sourcePath(".", filePath);
  if (
    !PINNED_REPOSITORY_REF_PATTERN.test(detectorCommit) ||
    !["packages/oxlint-plugin-react-doctor/src/", "packages/core/src/"].some((prefix) =>
      safePath.startsWith(prefix),
    ) ||
    !safePath.endsWith(".ts")
  )
    throw new Error("Detector reads are limited to pinned engine TypeScript source");
  const { stdout } = await executeFile("git", ["show", `${detectorCommit}:${safePath}`]);
  if (stdout.length > SOL_REVIEW_MAX_RULE_CHARACTERS)
    throw new Error("Detector source exceeds the review limit");
  return stdout;
};
