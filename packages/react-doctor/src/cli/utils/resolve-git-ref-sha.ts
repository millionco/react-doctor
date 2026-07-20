import { runGit } from "./git-hook-shared.js";

const isUnsafeGitRef = (ref: string): boolean => ref.startsWith("-") || ref.includes("@{");

export const resolveGitRefSha = (directory: string, ref: string): string | null => {
  if (ref.length === 0 || isUnsafeGitRef(ref)) return null;
  const resolvedRef = runGit(directory, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return resolvedRef === null ? null : resolvedRef;
};
