import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE_WORKTREE_DIR_NAME, CHECK_RUN_NAME, MAX_INLINE_COMMENTS_COUNT } from "./constants.ts";
import {
  buildInlineCommentCandidates,
  computeDiagnosticsDelta,
  formatAnalysisFailureComment,
  formatNoIssuesComment,
  formatPendingReviewComment,
  formatRegressionComment,
  getReviewCheckAssessment,
  isMissingReactProjectError,
  runDiagnoseAcrossWorkspace,
} from "./pipeline.ts";
import type { ChangedFile, DiagnoseSnapshot, InlineCommentCandidate } from "./pipeline.ts";
import {
  completeCheckRun,
  createCheckRun,
  createGitHubClient,
  deleteStickyComment,
  listPullRequestChangedFiles,
  postInlineReview,
  reconcileInlineThreads,
  resolveMergeBaseSha,
  upsertStickyComment,
} from "./github.ts";
import type { GitHubClient, PullRequestContext } from "./github.ts";

interface PullRequestEventPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number: number;
    head: {
      sha: string;
      ref: string;
      repo: { full_name: string; clone_url: string; owner: { login: string } } | null;
    };
    base: {
      sha: string;
      ref: string;
      repo: { full_name: string; clone_url: string; owner: { login: string } };
    };
  };
  repository?: { full_name: string; owner: { login: string }; name: string };
}

const readEventPayload = (): PullRequestEventPayload => {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath)
    throw new Error("GITHUB_EVENT_PATH is not set; this action requires a pull_request event.");
  const raw = fs.readFileSync(eventPath, "utf8");
  return JSON.parse(raw);
};

const readPullRequestContext = (): PullRequestContext => {
  const payload = readEventPayload();
  const pullRequest = payload.pull_request;
  if (!pullRequest) {
    throw new Error(
      "Event payload does not include pull_request; this action only runs on pull_request events.",
    );
  }
  const baseRepoFullName = pullRequest.base.repo.full_name;
  const [owner, repo] = baseRepoFullName.split("/");
  if (!owner || !repo) throw new Error(`Could not parse owner/repo from ${baseRepoFullName}.`);

  // HACK: `pull_request.head.repo` is nullable (deleted forks,
  // restricted fork metadata, etc.). Earlier code did
  // `pullRequest.head.repo?.full_name.split("/")[1]`, where `?.`
  // only guards `repo` — `full_name` would be undefined and `.split`
  // crashes. Funnel every field through the same `headRepoMeta`
  // guard so a null head repo produces a clean "same-repo PR"
  // snapshot instead of a runtime throw, and `isFork` is correctly
  // false only when `head.repo` is present AND matches the base repo.
  const headRepoMeta = pullRequest.head.repo;
  const headRepoFullName = headRepoMeta?.full_name ?? baseRepoFullName;
  const isFork = headRepoMeta !== null && headRepoFullName !== baseRepoFullName;
  const headOwner = headRepoMeta?.owner.login ?? owner;
  const headRepo = headRepoMeta?.full_name.split("/")[1] ?? repo;

  return {
    owner,
    repo,
    pullNumber: pullRequest.number,
    headSha: pullRequest.head.sha,
    baseSha: pullRequest.base.sha,
    baseRef: pullRequest.base.ref,
    headRef: pullRequest.head.ref,
    headOwner,
    headRepo,
    isFork,
  };
};

const resolveToken = (): string => {
  const token =
    process.env.REACT_DOCTOR_TOKEN || process.env.GITHUB_TOKEN || process.env.INPUT_TOKEN || "";
  if (!token) {
    throw new Error("No GitHub token available. Set REACT_DOCTOR_TOKEN or GITHUB_TOKEN.");
  }
  return token;
};

const resolveInputDirectory = (): string => process.env.INPUT_DIRECTORY || ".";

const resolveHeadDirectory = (): string => {
  const workspace = process.env.GITHUB_WORKSPACE;
  const inputDirectory = resolveInputDirectory();
  if (workspace) return path.resolve(workspace, inputDirectory);
  return path.resolve(process.cwd(), inputDirectory);
};

const resolveBaseWorktreeDirectory = (): string => {
  const tempRoot = process.env.RUNNER_TEMP || process.env.TMPDIR || "/tmp";
  return path.join(tempRoot, BASE_WORKTREE_DIR_NAME);
};

/**
 * Mirrors `resolveHeadDirectory`'s `INPUT_DIRECTORY` resolution
 * but rooted at the base worktree. Without this, a non-`.`
 * `directory` input scans the project subdirectory on HEAD but
 * the full worktree root on BASE — diagnostic counts and paths
 * disagree across the two snapshots, breaking regressions /
 * sticky summary / inline comment matching for monorepos that
 * scope the action to one package.
 */
const resolveBaseScanDirectory = (worktreeDirectory: string): string =>
  path.resolve(worktreeDirectory, resolveInputDirectory());

const runGit = (args: string[], cwd: string): void => {
  execFileSync("git", args, { cwd, stdio: "inherit" });
};

const tryRunGit = (args: string[], cwd: string): boolean => {
  try {
    runGit(args, cwd);
    return true;
  } catch {
    return false;
  }
};

const materializeBaseWorktree = (
  headDirectory: string,
  baseSha: string,
  baseRepoFullName: string,
  token: string,
): string => {
  const worktreeDirectory = resolveBaseWorktreeDirectory();
  fs.rmSync(worktreeDirectory, { recursive: true, force: true });

  const remoteUrl = `https://x-access-token:${token}@github.com/${baseRepoFullName}.git`;
  const remoteName = "react-doctor-base";

  tryRunGit(["remote", "remove", remoteName], headDirectory);
  runGit(["remote", "add", remoteName, remoteUrl], headDirectory);
  try {
    runGit(["fetch", "--depth=1", remoteName, baseSha], headDirectory);
    runGit(["worktree", "add", "--detach", worktreeDirectory, baseSha], headDirectory);
  } finally {
    tryRunGit(["remote", "remove", remoteName], headDirectory);
  }

  return worktreeDirectory;
};

const cleanupBaseWorktree = (headDirectory: string, worktreeDirectory: string): void => {
  if (!fs.existsSync(worktreeDirectory)) return;
  tryRunGit(["worktree", "remove", "--force", worktreeDirectory], headDirectory);
  fs.rmSync(worktreeDirectory, { recursive: true, force: true });
};

const indexChangedFilesByPath = (changedFiles: ChangedFile[]): Map<string, ChangedFile> => {
  const indexed = new Map<string, ChangedFile>();
  for (const file of changedFiles) indexed.set(file.filename, file);
  return indexed;
};

const capCandidates = (
  candidates: InlineCommentCandidate[],
  activeThreadKeys: Set<string>,
): InlineCommentCandidate[] => {
  const fresh = candidates.filter((candidate) => !activeThreadKeys.has(candidate.threadKey));
  return fresh.slice(0, MAX_INLINE_COMMENTS_COUNT);
};

const logInfo = (message: string): void => {
  console.log(`[react-doctor-review] ${message}`);
};

const logWarning = (message: string): void => {
  console.warn(`::warning::[react-doctor-review] ${message}`);
};

const logError = (message: string): void => {
  console.error(`::error::[react-doctor-review] ${message}`);
};

const main = async (): Promise<void> => {
  const context = readPullRequestContext();
  if (context.isFork) {
    logWarning(
      `PR head is from a fork (${context.headOwner}/${context.headRepo}). GITHUB_TOKEN may not have write access; pass a token input override if needed.`,
    );
  }

  const token = resolveToken();
  const client = createGitHubClient(token);
  const headDirectory = resolveHeadDirectory();

  let pendingCommentPosted = false;
  let worktreeDirectory: string | null = null;
  const checkRunHandle = await createCheckRun(client, context);

  try {
    await upsertStickyComment(client, context, formatPendingReviewComment());
    pendingCommentPosted = true;

    const baseSha = await resolveMergeBaseSha(client, context);
    logInfo(`Resolved merge base: ${baseSha}`);

    worktreeDirectory = materializeBaseWorktree(
      headDirectory,
      baseSha,
      `${context.owner}/${context.repo}`,
      token,
    );
    logInfo(`Materialized base worktree at ${worktreeDirectory}`);

    const changedFiles = await listPullRequestChangedFiles(client, context);
    const changedFilesByPath = indexChangedFilesByPath(changedFiles);
    logInfo(`Listed ${changedFiles.length} changed file(s).`);

    let headSnapshot: DiagnoseSnapshot;
    let baseSnapshot: DiagnoseSnapshot;
    try {
      [headSnapshot, baseSnapshot] = await Promise.all([
        runDiagnoseAcrossWorkspace(headDirectory),
        runDiagnoseAcrossWorkspace(resolveBaseScanDirectory(worktreeDirectory)),
      ]);
    } catch (error) {
      // Only project-discovery failures collapse to the friendly
      // "not a React project" outcome. AmbiguousProjectError (also
      // a ReactDoctorError) means "multiple React roots found" —
      // propagating it surfaces the misconfiguration instead of
      // silently posting a misleading "Not a React project" check.
      if (isMissingReactProjectError(error)) {
        await handleNotAReactProject(client, context, checkRunHandle);
        return;
      }
      throw error;
    }

    if (!headSnapshot.hasReact) {
      await handleNotAReactProject(client, context, checkRunHandle);
      return;
    }

    const { newDiagnostics, fixedDiagnostics } = computeDiagnosticsDelta(
      headSnapshot.diagnostics,
      baseSnapshot.diagnostics,
    );
    logInfo(
      `Diff: ${newDiagnostics.length} new, ${fixedDiagnostics.length} fixed (head=${headSnapshot.diagnostics.length}, base=${baseSnapshot.diagnostics.length}).`,
    );

    const inlineCandidates = buildInlineCommentCandidates(newDiagnostics, changedFilesByPath);

    const { activeThreadKeys, resolvedCount } = await reconcileInlineThreads(
      client,
      context,
      new Set(inlineCandidates.map((candidate) => candidate.threadKey)),
    );
    if (resolvedCount > 0) logInfo(`Resolved ${resolvedCount} addressed thread(s).`);

    const toPost = capCandidates(inlineCandidates, activeThreadKeys);
    if (toPost.length > 0) {
      try {
        await postInlineReview(client, context, toPost);
        logInfo(`Posted ${toPost.length} inline comment(s).`);
      } catch (error) {
        if (context.isFork) {
          logWarning(
            `Failed to post inline review on fork PR (expected without elevated token): ${(error as Error).message}`,
          );
        } else {
          throw error;
        }
      }
    }

    const commentInput = {
      headScore: headSnapshot.combinedScore,
      baseScore: baseSnapshot.combinedScore,
      projects: headSnapshot.projects,
      newDiagnostics,
      fixedDiagnostics,
      headSha: context.headSha,
    };

    const stickyBody =
      newDiagnostics.length === 0
        ? formatNoIssuesComment(commentInput)
        : formatRegressionComment(commentInput);

    try {
      await upsertStickyComment(client, context, stickyBody);
    } catch (error) {
      if (context.isFork) {
        logWarning(`Failed to upsert sticky comment on fork PR: ${(error as Error).message}`);
      } else {
        throw error;
      }
    }

    const conclusion = newDiagnostics.length === 0 ? "success" : "neutral";
    const title =
      newDiagnostics.length === 0
        ? "No new React Doctor regressions"
        : `${newDiagnostics.length} new React Doctor diagnostic(s)`;
    const detailedBody = getReviewCheckAssessment(commentInput);

    await completeCheckRun(client, context, checkRunHandle, {
      conclusion,
      title,
      summary: title,
      detailedBody,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Analysis failed: ${message}`);
    try {
      await completeCheckRun(client, context, checkRunHandle, {
        conclusion: "failure",
        title: "React Doctor Review failed",
        summary: message,
      });
    } catch {
      // Check-run failure update is best-effort.
    }
    if (pendingCommentPosted) {
      try {
        await upsertStickyComment(client, context, formatAnalysisFailureComment(message));
      } catch {
        // Sticky update failure is best-effort.
      }
    }
    throw error;
  } finally {
    if (worktreeDirectory) cleanupBaseWorktree(headDirectory, worktreeDirectory);
  }
};

const handleNotAReactProject = async (
  client: GitHubClient,
  context: PullRequestContext,
  checkRunHandle: { id: number },
): Promise<void> => {
  logInfo("No React dependency detected on head; skipping review.");
  await completeCheckRun(client, context, checkRunHandle, {
    conclusion: "skipped",
    title: CHECK_RUN_NAME,
    summary: "Not a React project - no diagnostics produced.",
  });
  await deleteStickyComment(client, context);
};

const isDirectInvocation = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectInvocation) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { main };
