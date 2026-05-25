import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveGithubActionsScoreMetadata } from "@react-doctor/core";

let temporaryDirectory: string;

interface TestEnvironmentOverrides {
  readonly NODE_ENV?: NodeJS.ProcessEnv["NODE_ENV"];
  readonly GITHUB_ACTIONS?: string;
  readonly GITHUB_EVENT_NAME?: string;
  readonly GITHUB_EVENT_PATH?: string;
}

const writeEventPayload = (payload: unknown): string => {
  const eventPath = path.join(temporaryDirectory, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify(payload));
  return eventPath;
};

const buildEnvironment = (overrides: TestEnvironmentOverrides): NodeJS.ProcessEnv => ({
  ...overrides,
  NODE_ENV: overrides.NODE_ENV ?? "test",
});

describe("resolveGithubActionsScoreMetadata", () => {
  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-gh-score-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("returns empty metadata outside GitHub Actions", () => {
    expect(
      resolveGithubActionsScoreMetadata(buildEnvironment({ GITHUB_ACTIONS: "false" })),
    ).toEqual({});
  });

  it("extracts pull request relationship metadata", () => {
    const eventPath = writeEventPayload({
      pull_request: {
        author_association: "CONTRIBUTOR",
      },
    });
    const environment = buildEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
    });

    expect(resolveGithubActionsScoreMetadata(environment)).toEqual({
      githubEventName: "pull_request",
      githubActorAssociation: "CONTRIBUTOR",
    });
  });

  it("keeps non-pull-request events lightweight", () => {
    const eventPath = writeEventPayload({
      repository: { private: true },
    });
    const environment = buildEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: eventPath,
    });

    expect(resolveGithubActionsScoreMetadata(environment)).toEqual({
      githubEventName: "push",
    });
  });
});
