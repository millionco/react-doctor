import * as fs from "node:fs";

export interface GitHubActionsScoreMetadata {
  readonly githubEventName?: string;
  readonly githubActorAssociation?: string;
}

const getObjectProperty = (value: unknown, propertyName: string): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, propertyName);
};

const getStringProperty = (value: unknown, propertyName: string): string | undefined => {
  const propertyValue = getObjectProperty(value, propertyName);
  return typeof propertyValue === "string" && propertyValue.length > 0 ? propertyValue : undefined;
};

const readGithubEventPayload = (eventPath: string | undefined): unknown => {
  if (eventPath === undefined || eventPath.length === 0) return null;

  try {
    const parsedPayload: unknown = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return parsedPayload;
  } catch {
    return null;
  }
};

export const resolveGithubActionsScoreMetadata = (
  environment: NodeJS.ProcessEnv = process.env,
): GitHubActionsScoreMetadata => {
  if (environment.GITHUB_ACTIONS !== "true") return {};

  const eventPayload = readGithubEventPayload(environment.GITHUB_EVENT_PATH);
  const pullRequest = getObjectProperty(eventPayload, "pull_request");
  const eventName = environment.GITHUB_EVENT_NAME;
  const actorAssociation = getStringProperty(pullRequest, "author_association");

  return {
    ...(eventName !== undefined && eventName.length > 0 ? { githubEventName: eventName } : {}),
    ...(actorAssociation !== undefined ? { githubActorAssociation: actorAssociation } : {}),
  };
};
