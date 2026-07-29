import { describe, expect, it } from "vite-plus/test";
import { buildScoreRequestMetadata } from "../src/utils/build-score-request-metadata.js";

const project = {
  framework: "vite",
  reactVersion: "19.0.0",
  sourceFileCount: 42,
};

describe("buildScoreRequestMetadata", () => {
  it("assembles every score metadata source in the legacy property order", () => {
    const metadata = buildScoreRequestMetadata({
      project,
      repo: "millionco/react-doctor",
      sha: "abc123",
      defaultBranch: "main",
      doctorVersion: "1.2.3",
      runId: "run-123",
      githubActionsScoreMetadata: {
        githubEventName: "pull_request",
        githubActorAssociation: "MEMBER",
      },
      githubViewerPermission: "maintain",
    });

    expect(JSON.stringify(metadata)).toBe(
      '{"repo":"millionco/react-doctor","sha":"abc123","framework":"vite","reactVersion":"19.0.0","sourceFileCount":42,"defaultBranch":"main","doctorVersion":"1.2.3","runId":"run-123","githubEventName":"pull_request","githubActorAssociation":"MEMBER","githubViewerPermission":"maintain"}',
    );
  });

  it("omits only nullish optional values", () => {
    expect(
      buildScoreRequestMetadata({
        project: {
          ...project,
          reactVersion: null,
        },
        repo: null,
        sha: null,
        defaultBranch: null,
        githubActionsScoreMetadata: {},
        githubViewerPermission: null,
      }),
    ).toEqual({
      framework: "vite",
      sourceFileCount: 42,
    });
  });

  it("preserves defined empty strings for exact compatibility", () => {
    expect(
      buildScoreRequestMetadata({
        project,
        repo: "",
        sha: "",
        defaultBranch: "",
        doctorVersion: "",
        runId: "",
        githubActionsScoreMetadata: {},
        githubViewerPermission: "",
      }),
    ).toEqual({
      repo: "",
      sha: "",
      framework: "vite",
      reactVersion: "19.0.0",
      sourceFileCount: 42,
      defaultBranch: "",
      doctorVersion: "",
      runId: "",
      githubViewerPermission: "",
    });
  });
});
