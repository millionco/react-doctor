import { isGradableFile } from "./is-gradable-file.js";
import { runCommand } from "./run-command.js";

export interface DiffSummary {
  changedFiles: string[];
  addedLineCount: number;
  // Set when git could not produce a diff (not a repo, bad base ref). The
  // caller decides whether to fall back to scanning the whole tree.
  error: string | null;
}

// Parse `git diff --numstat` output ("added<TAB>deleted<TAB>path") into the set
// of gradable changed files and their total added lines. Binary files report
// "-" for counts and contribute zero added lines.
const parseNumstat = (numstat: string): DiffSummary => {
  const changedFiles: string[] = [];
  let addedLineCount = 0;
  for (const line of numstat.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [addedRaw, , ...pathParts] = trimmed.split("\t");
    const filePath = pathParts.join("\t");
    if (!filePath || !isGradableFile(filePath)) continue;
    changedFiles.push(filePath);
    const added = Number.parseInt(addedRaw ?? "", 10);
    if (Number.isFinite(added)) addedLineCount += added;
  }
  return { changedFiles, addedLineCount, error: null };
};

// Compute the agent's graded diff against `baseRef`. Marks untracked files with
// intent-to-add first (`git add -A -N`) so brand-new files the agent created
// show up in `git diff` exactly like edits to tracked files.
export const collectDiff = (rootDirectory: string, baseRef: string): DiffSummary => {
  runCommand("git", ["-C", rootDirectory, "add", "-A", "-N"], { cwd: rootDirectory });
  const result = runCommand(
    "git",
    ["-C", rootDirectory, "diff", "--numstat", "--no-color", baseRef],
    { cwd: rootDirectory },
  );
  if (result.spawnFailed || result.exitCode !== 0) {
    return {
      changedFiles: [],
      addedLineCount: 0,
      error: result.stderr.trim() || "git diff failed",
    };
  }
  return parseNumstat(result.stdout);
};
