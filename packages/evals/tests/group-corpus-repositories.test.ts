import { describe, expect, it } from "vite-plus/test";

import { groupCorpusRepositories } from "../src/group-corpus-repositories.js";

describe("groupCorpusRepositories", () => {
  it("shares one sandbox across roots from the same pinned repository", () => {
    expect(
      groupCorpusRepositories([
        { org: "example", name: "project", ref: "abc123", rootDir: "packages/app" },
        { org: "example", name: "project", ref: "abc123", rootDir: "packages/ui" },
        { org: "example", name: "project", ref: "def456", rootDir: "." },
      ]),
    ).toEqual([
      {
        org: "example",
        name: "project",
        ref: "abc123",
        rootDirectories: ["packages/app", "packages/ui"],
      },
      {
        org: "example",
        name: "project",
        ref: "def456",
        rootDirectories: ["."],
      },
    ]);
  });
});
