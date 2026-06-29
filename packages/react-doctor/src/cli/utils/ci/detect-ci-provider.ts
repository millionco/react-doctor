import * as path from "node:path";
import * as fs from "node:fs";
import { runCommand, type CommandRunner } from "../run-command.js";
import type { CiProviderId } from "./ci-provider.js";
import { githubActionsProvider } from "./github-actions-provider.js";
import { gitlabCiProvider } from "./gitlab-ci-provider.js";

// Picks the CI backend a repo already uses, strongest signal first:
//
// 1. React Doctor's own workflow file already on disk — it's React-Doctor-specific.
// 2. The git remote host — the authoritative platform signal. It's checked
//    before the generic on-disk files so a GitHub repo carrying a stray or
//    legacy `.gitlab-ci.yml` (e.g. from a mirror) isn't misread as GitLab.
// 3. A generic CI file/dir on disk — the fallback when the remote is missing
//    or a host we don't recognize (self-hosted).
//
// Returns null when nothing is conclusive, so the caller can ask rather than guess.
export const detectCiProvider = async (
  projectRoot: string,
  run: CommandRunner = runCommand,
): Promise<CiProviderId | null> => {
  if (githubActionsProvider.readWorkflow(projectRoot)) return "github-actions";

  const remote = await run("git", ["remote", "get-url", "origin"], projectRoot);
  if (remote.success) {
    if (/github\.com[:/]/i.test(remote.stdout)) return "github-actions";
    if (/gitlab/i.test(remote.stdout)) return "gitlab-ci";
  }

  if (fs.existsSync(path.join(projectRoot, ".github", "workflows"))) return "github-actions";
  if (gitlabCiProvider.readWorkflow(projectRoot)) return "gitlab-ci";
  return null;
};
