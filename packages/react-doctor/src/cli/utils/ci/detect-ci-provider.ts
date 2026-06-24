import * as path from "node:path";
import * as fs from "node:fs";
import { runCommand, type CommandRunner } from "../run-command.js";
import type { CiProviderId } from "./ci-provider.js";
import { githubActionsProvider } from "./github-actions-provider.js";
import { gitlabCiProvider } from "./gitlab-ci-provider.js";

// Picks the CI backend a repo already uses. A config file that's already on
// disk is the strongest signal (it beats whatever the remote host implies),
// then the presence of a `.github/workflows` directory, then the git remote
// host. Returns null when nothing is conclusive, so the caller can ask rather
// than guess.
export const detectCiProvider = async (
  projectRoot: string,
  run: CommandRunner = runCommand,
): Promise<CiProviderId | null> => {
  if (githubActionsProvider.readWorkflow(projectRoot)) return "github-actions";
  if (gitlabCiProvider.readWorkflow(projectRoot)) return "gitlab-ci";
  if (fs.existsSync(path.join(projectRoot, ".github", "workflows"))) return "github-actions";

  const remote = await run("git", ["remote", "get-url", "origin"], projectRoot);
  if (remote.success) {
    if (/github\.com[:/]/i.test(remote.stdout)) return "github-actions";
    if (/gitlab/i.test(remote.stdout)) return "gitlab-ci";
  }
  return null;
};
