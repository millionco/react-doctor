import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import {
  CHECK_RUN_NAME,
  GITHUB_GRAPHQL_PAGE_SIZE,
  INLINE_COMMENT_MARKER_PREFIX,
  STICKY_COMMENT_MARKER,
} from "./constants.ts";
import type { ChangedFile, InlineCommentCandidate } from "./pipeline.ts";
import { parseAddedLineContents } from "./pipeline.ts";

export interface PullRequestContext {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  baseSha: string;
  baseRef: string;
  headRef: string;
  headOwner: string;
  headRepo: string;
  isFork: boolean;
}

export interface GitHubClient {
  octokit: Octokit;
  graphqlClient: typeof graphql;
}

export const createGitHubClient = (token: string): GitHubClient => {
  const octokit = new Octokit({ auth: token });
  const graphqlClient = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
  return { octokit, graphqlClient };
};

export const resolveMergeBaseSha = async (
  client: GitHubClient,
  context: PullRequestContext,
): Promise<string> => {
  const headIdentifier = context.isFork
    ? `${context.headOwner}:${context.headRef}`
    : context.headRef;
  const { data } = await client.octokit.repos.compareCommitsWithBasehead({
    owner: context.owner,
    repo: context.repo,
    basehead: `${context.baseRef}...${headIdentifier}`,
  });
  return data.merge_base_commit.sha;
};

export const listPullRequestChangedFiles = async (
  client: GitHubClient,
  context: PullRequestContext,
): Promise<ChangedFile[]> => {
  const files = await client.octokit.paginate(client.octokit.pulls.listFiles, {
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber,
    per_page: 100,
  });

  return files.map((file) => ({
    filename: file.filename,
    patch: file.patch ?? null,
    addedLineContents: parseAddedLineContents(file.patch),
  }));
};

interface ReviewThreadComment {
  databaseId: number;
  body: string;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  comments: { nodes: ReviewThreadComment[] };
}

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ReviewThread[];
      };
    };
  };
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: ${GITHUB_GRAPHQL_PAGE_SIZE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            originalLine
            comments(first: ${GITHUB_GRAPHQL_PAGE_SIZE}) {
              nodes { databaseId body }
            }
          }
        }
      }
    }
  }
`;

const RESOLVE_THREAD_MUTATION = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;

const fetchAllReviewThreads = async (
  client: GitHubClient,
  context: PullRequestContext,
): Promise<ReviewThread[]> => {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  while (true) {
    const response: ReviewThreadsResponse = await client.graphqlClient(REVIEW_THREADS_QUERY, {
      owner: context.owner,
      repo: context.repo,
      number: context.pullNumber,
      cursor,
    });
    threads.push(...response.repository.pullRequest.reviewThreads.nodes);
    const pageInfo = response.repository.pullRequest.reviewThreads.pageInfo;
    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return threads;
};

const THREAD_KEY_HEADER_PATTERN = /^<!-- react-doctor-review-inline:([^\n]+?) -->/m;

const buildInlineCommentBodyWithKey = (threadKey: string, body: string): string =>
  `${INLINE_COMMENT_MARKER_PREFIX}${threadKey} -->\n${body}`;

const extractThreadKeyFromBody = (body: string): string | null => {
  const match = body.match(THREAD_KEY_HEADER_PATTERN);
  return match ? (match[1] ?? null) : null;
};

const isOwnedReviewThread = (thread: ReviewThread): boolean =>
  thread.comments.nodes.some((comment) => comment.body.includes(INLINE_COMMENT_MARKER_PREFIX));

export interface ReconcileInlineThreadsResult {
  activeThreadKeys: Set<string>;
  resolvedCount: number;
}

const RESOLUTION_FOOTER = (headSha: string): string => `\n\n---\n✅ Addressed in ${headSha}`;

export const reconcileInlineThreads = async (
  client: GitHubClient,
  context: PullRequestContext,
  activeCandidateKeys: Set<string>,
): Promise<ReconcileInlineThreadsResult> => {
  const threads = await fetchAllReviewThreads(client, context);
  const ownedThreads = threads.filter(isOwnedReviewThread);
  const activeThreadKeys = new Set<string>();
  let resolvedCount = 0;

  for (const thread of ownedThreads) {
    if (thread.comments.nodes.length === 0) continue;
    const headComment = thread.comments.nodes[0];
    if (!headComment) continue;
    const threadKey = extractThreadKeyFromBody(headComment.body);
    if (!threadKey) continue;

    if (activeCandidateKeys.has(threadKey)) {
      activeThreadKeys.add(threadKey);
      continue;
    }

    if (thread.isResolved) continue;

    const addressedFooter = RESOLUTION_FOOTER(context.headSha);
    if (!headComment.body.includes(addressedFooter.trim())) {
      try {
        await client.octokit.pulls.updateReviewComment({
          owner: context.owner,
          repo: context.repo,
          comment_id: headComment.databaseId,
          body: `${headComment.body}${addressedFooter}`,
        });
      } catch {
        // Comment may have been deleted; continue resolving.
      }
    }

    try {
      await client.graphqlClient(RESOLVE_THREAD_MUTATION, { threadId: thread.id });
      resolvedCount += 1;
    } catch {
      // Permission may be insufficient; skip silently.
    }
  }

  return { activeThreadKeys, resolvedCount };
};

export const postInlineReview = async (
  client: GitHubClient,
  context: PullRequestContext,
  candidates: InlineCommentCandidate[],
): Promise<void> => {
  if (candidates.length === 0) return;
  const comments = candidates.map((candidate) => ({
    path: candidate.relativePath,
    line: candidate.line,
    side: "RIGHT" as const,
    body: buildInlineCommentBodyWithKey(candidate.threadKey, candidate.body),
  }));

  await client.octokit.pulls.createReview({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber,
    event: "COMMENT",
    commit_id: context.headSha,
    comments,
  });
};

const findExistingStickyComment = async (
  client: GitHubClient,
  context: PullRequestContext,
): Promise<{ id: number; body: string } | null> => {
  const comments = await client.octokit.paginate(client.octokit.issues.listComments, {
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pullNumber,
    per_page: 100,
  });
  const match = comments.find((comment) => comment.body?.includes(STICKY_COMMENT_MARKER));
  if (!match) return null;
  return { id: match.id, body: match.body ?? "" };
};

export const upsertStickyComment = async (
  client: GitHubClient,
  context: PullRequestContext,
  body: string,
): Promise<void> => {
  const bodyWithMarker = body.includes(STICKY_COMMENT_MARKER)
    ? body
    : `${STICKY_COMMENT_MARKER}\n${body}`;

  const existing = await findExistingStickyComment(client, context);
  if (existing) {
    await client.octokit.issues.updateComment({
      owner: context.owner,
      repo: context.repo,
      comment_id: existing.id,
      body: bodyWithMarker,
    });
    return;
  }

  await client.octokit.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pullNumber,
    body: bodyWithMarker,
  });
};

export const deleteStickyComment = async (
  client: GitHubClient,
  context: PullRequestContext,
): Promise<void> => {
  const existing = await findExistingStickyComment(client, context);
  if (!existing) return;
  try {
    await client.octokit.issues.deleteComment({
      owner: context.owner,
      repo: context.repo,
      comment_id: existing.id,
    });
  } catch {
    // Best effort.
  }
};

export type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "skipped"
  | "cancelled"
  | "timed_out"
  | "action_required";

export interface CheckRunHandle {
  id: number;
}

export const createCheckRun = async (
  client: GitHubClient,
  context: PullRequestContext,
): Promise<CheckRunHandle> => {
  const { data } = await client.octokit.checks.create({
    owner: context.owner,
    repo: context.repo,
    name: CHECK_RUN_NAME,
    head_sha: context.headSha,
    status: "in_progress",
    started_at: new Date().toISOString(),
  });
  return { id: data.id };
};

export interface CheckRunCompletionInput {
  conclusion: CheckConclusion;
  title: string;
  summary: string;
  detailedBody?: string;
}

export const completeCheckRun = async (
  client: GitHubClient,
  context: PullRequestContext,
  handle: CheckRunHandle,
  completion: CheckRunCompletionInput,
): Promise<void> => {
  await client.octokit.checks.update({
    owner: context.owner,
    repo: context.repo,
    check_run_id: handle.id,
    status: "completed",
    conclusion: completion.conclusion,
    completed_at: new Date().toISOString(),
    output: {
      title: completion.title,
      summary: completion.summary,
      ...(completion.detailedBody ? { text: completion.detailedBody } : {}),
    },
  });
};
