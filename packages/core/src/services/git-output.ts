import type { GitBaselineDiffPlan } from "./git-contracts.js";

export const trimGitOutputOrNull = (value: string): string | null => {
  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? null : trimmedValue;
};

export const parseGithubRemoteRepository = (remoteUrl: string): string | null => {
  const withoutGitSuffix = remoteUrl.trim().replace(/\.git$/, "");
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/.exec(withoutGitSuffix);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

  const urlMatch =
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)$/.exec(
      withoutGitSuffix,
    );
  return urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : null;
};

export const parseGithubViewerPermission = (stdout: string): string | null => {
  const value = trimGitOutputOrNull(stdout);
  if (value === null || value === "null") return null;
  return /^[A-Z_]+$/.test(value) ? value.toLowerCase() : null;
};

export const splitNullSeparatedGitOutput = (value: string): ReadonlyArray<string> =>
  value.split("\0").filter((entry) => entry.length > 0);

export const parseGitBaselineDiffPlan = (value: string): GitBaselineDiffPlan | null => {
  const entries = splitNullSeparatedGitOutput(value);
  const baseFiles = new Set<string>();
  const headFiles = new Set<string>();
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 2) {
    const status = entries[entryIndex];
    const filePath = entries[entryIndex + 1];
    if (status === undefined || filePath === undefined || status.length !== 1) return null;
    if (status === "A") {
      headFiles.add(filePath);
      continue;
    }
    if (status === "D") {
      baseFiles.add(filePath);
      continue;
    }
    if (status === "M" || status === "T") {
      baseFiles.add(filePath);
      headFiles.add(filePath);
      continue;
    }
    return null;
  }
  return { baseFiles: [...baseFiles], headFiles: [...headFiles], untrackedFiles: [] };
};
