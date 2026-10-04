import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClassificationCandidate } from "../classification-schema.js";
import { CLASSIFICATION_MAX_CODE_CHARACTERS } from "../constants.js";

const executeFile = promisify(execFile);
const ruleTrees = new Map<string, Promise<string[]>>();

export const loadPinnedRuleSource = async (candidate: ClassificationCandidate): Promise<string> => {
  let tree = ruleTrees.get(candidate.detectorCommit);
  if (!tree) {
    tree = executeFile("git", [
      "ls-tree",
      "-r",
      "--name-only",
      candidate.detectorCommit,
      "packages/oxlint-plugin-react-doctor/src/plugin/rules",
    ]).then(({ stdout }) => stdout.trim().split("\n"));
    ruleTrees.set(candidate.detectorCommit, tree);
  }
  const ruleName = candidate.rule.key.split("/")[1];
  const paths = (await tree).filter((path) => path.endsWith(`/${ruleName}.ts`));
  if (paths.length !== 1)
    return "Pinned rule implementation unavailable; do not infer its exceptions.";
  const { stdout } = await executeFile("git", ["show", `${candidate.detectorCommit}:${paths[0]}`]);
  if (stdout.length > CLASSIFICATION_MAX_CODE_CHARACTERS)
    return "Pinned rule implementation exceeds the context limit; exceptions are unresolved.";
  return `${paths[0]}\n${stdout}`;
};
