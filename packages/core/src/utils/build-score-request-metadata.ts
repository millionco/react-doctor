import type { ScoreRequestMetadata } from "../calculate-score.js";
import type { ProjectInfo } from "../types/index.js";
import type { GitHubActionsScoreMetadata } from "./resolve-github-actions-score-metadata.js";

interface ScoreMetadataProject {
  readonly framework: ProjectInfo["framework"];
  readonly reactVersion: string | null;
  readonly sourceFileCount: number;
}

interface BuildScoreRequestMetadataInput {
  readonly project: ScoreMetadataProject;
  readonly repo: string | null;
  readonly sha: string | null;
  readonly defaultBranch: string | null;
  readonly doctorVersion?: string;
  readonly runId?: string;
  readonly githubActionsScoreMetadata: GitHubActionsScoreMetadata;
  readonly githubViewerPermission: string | null;
}

export const buildScoreRequestMetadata = (
  input: BuildScoreRequestMetadataInput,
): ScoreRequestMetadata => ({
  ...(input.repo !== null ? { repo: input.repo } : {}),
  ...(input.sha !== null ? { sha: input.sha } : {}),
  framework: input.project.framework,
  ...(input.project.reactVersion !== null ? { reactVersion: input.project.reactVersion } : {}),
  sourceFileCount: input.project.sourceFileCount,
  ...(input.defaultBranch !== null ? { defaultBranch: input.defaultBranch } : {}),
  ...(input.doctorVersion !== undefined ? { doctorVersion: input.doctorVersion } : {}),
  ...(input.runId !== undefined ? { runId: input.runId } : {}),
  ...input.githubActionsScoreMetadata,
  ...(input.githubViewerPermission !== null
    ? { githubViewerPermission: input.githubViewerPermission }
    : {}),
});
