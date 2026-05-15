import type { KnipIssueRecords } from "../types/knip.js";
import { isPlainObject } from "./is-plain-object.js";

export const collectUnusedFilePaths = (
  filesIssues: KnipIssueRecords | Set<string> | string[] | unknown,
): string[] => {
  if (filesIssues instanceof Set) {
    return [...filesIssues];
  }

  if (Array.isArray(filesIssues)) {
    return filesIssues.filter((entry): entry is string => typeof entry === "string");
  }

  if (!isPlainObject(filesIssues)) {
    return [];
  }

  const unusedFilePaths: string[] = [];

  for (const innerValue of Object.values(filesIssues)) {
    if (!isPlainObject(innerValue)) continue;

    for (const issue of Object.values(innerValue)) {
      if (isPlainObject(issue) && typeof issue.filePath === "string") {
        unusedFilePaths.push(issue.filePath);
      }
    }
  }

  return unusedFilePaths;
};
