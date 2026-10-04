import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClassificationCandidate } from "../classification-schema.js";
import {
  CLASSIFICATION_MAX_CODE_CHARACTERS,
  SOL_REVIEW_MAX_RULE_CHARACTERS,
} from "../constants.js";
import { loadPinnedDetectorFile } from "./load-pinned-detector-file.js";

const executeFile = promisify(execFile);
const ruleTrees = new Map<string, Promise<string[]>>();

export const loadPinnedRuleSource = async (
  candidate: ClassificationCandidate,
  extendedContext = false,
): Promise<string> => {
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
  const stdout = await loadPinnedDetectorFile({
    detectorCommit: candidate.detectorCommit,
    filePath: paths[0],
  });
  if (
    stdout.length >
    (extendedContext ? SOL_REVIEW_MAX_RULE_CHARACTERS : CLASSIFICATION_MAX_CODE_CHARACTERS)
  )
    return "Pinned rule implementation exceeds the context limit; exceptions are unresolved.";
  if (!extendedContext) return `${paths[0]}\n${stdout}`;
  const wrapperPath = "packages/oxlint-plugin-react-doctor/src/plugin/utils/define-rule.ts";
  const wrapper = await loadPinnedDetectorFile({
    detectorCommit: candidate.detectorCommit,
    filePath: wrapperPath,
  });
  return `${paths[0]}\n${stdout}\n\nShared rule gates: ${wrapperPath}\n${wrapper}`;
};
