import { runGit, runGitRaw } from "./git-hook-shared.js";

interface BaselineLineHunk {
  readonly baseStart: number;
  readonly baseCount: number;
  readonly headStart: number;
  readonly headCount: number;
}

export const readBaselineLineMap = (
  directory: string,
  ref: string | undefined,
): ((filePath: string, baseLine: number) => number) => {
  const hunksByFile = new Map<string, BaselineLineHunk[]>();
  const revision = ref
    ? runGit(directory, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    : null;
  const patch = revision
    ? runGitRaw(directory, [
        "-c",
        "core.quotePath=false",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=0",
        "--find-renames",
        "--relative",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        revision,
        "--",
      ])
    : null;
  let currentHunks: BaselineLineHunk[] | undefined;
  for (const line of patch?.split("\n") ?? []) {
    if (line.startsWith("+++ ")) {
      currentHunks = [];
      const headerPath = line.slice("+++ ".length).replace(/\t$/, "");
      let filePath = headerPath;
      if (headerPath.startsWith('"')) {
        try {
          filePath = JSON.parse(headerPath);
        } catch {
          continue;
        }
      }
      if (filePath.startsWith("b/")) hunksByFile.set(filePath.slice("b/".length), currentHunks);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !currentHunks) continue;
    currentHunks.push({
      baseStart: Number(hunk[1]),
      baseCount: hunk[2] === undefined ? 1 : Number(hunk[2]),
      headStart: Number(hunk[3]),
      headCount: hunk[4] === undefined ? 1 : Number(hunk[4]),
    });
  }
  return (filePath, baseLine) => {
    let lineOffset = 0;
    for (const hunk of hunksByFile.get(filePath) ?? []) {
      if (baseLine < hunk.baseStart) break;
      if (hunk.baseCount > 0 && baseLine < hunk.baseStart + hunk.baseCount) {
        return (
          hunk.headStart + Math.min(baseLine - hunk.baseStart, Math.max(0, hunk.headCount - 1))
        );
      }
      if (hunk.baseCount === 0 && baseLine === hunk.baseStart) break;
      lineOffset =
        hunk.headStart +
        Math.max(1, hunk.headCount) -
        (hunk.baseStart + Math.max(1, hunk.baseCount));
    }
    return baseLine + lineOffset;
  };
};
