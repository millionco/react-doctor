import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import {
  Git,
  GitBaseBranchInvalid,
  GitBaseBranchMissing,
  ReactDoctorError,
} from "@react-doctor/core";

const runWith = <Value>(
  layer: ReturnType<typeof Git.layerOf>,
  program: Effect.Effect<Value, ReactDoctorError, Git>,
): Value => Effect.runSync(program.pipe(Effect.provide(layer)));

describe("Git.layerOf", () => {
  it("returns the snapshot's current branch and default branch", () => {
    const layer = Git.layerOf({
      currentBranch: "feature/x",
      defaultBranch: "main",
    });

    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        const current = yield* git.currentBranch("/repo");
        const fallback = yield* git.defaultBranch("/repo");
        return { current, fallback };
      }),
    );

    expect(result).toEqual({ current: "feature/x", fallback: "main" });
  });

  it("treats a missing snapshot value as null", () => {
    const layer = Git.layerOf({});
    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return {
          current: yield* git.currentBranch("/repo"),
          fallback: yield* git.defaultBranch("/repo"),
          headSha: yield* git.headSha("/repo"),
          githubRepo: yield* git.githubRepo("/repo"),
        };
      }),
    );
    expect(result).toEqual({ current: null, fallback: null, headSha: null, githubRepo: null });
  });

  it("returns score metadata fields from the snapshot", () => {
    const layer = Git.layerOf({
      headSha: "abc123",
      githubRepo: "millionco/react-doctor",
    });
    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return {
          headSha: yield* git.headSha("/repo"),
          githubRepo: yield* git.githubRepo("/repo"),
          githubViewerPermission: yield* git.githubViewerPermission({
            directory: "/repo",
            repo: "millionco/react-doctor",
          }),
        };
      }),
    );
    expect(result).toEqual({
      headSha: "abc123",
      githubRepo: "millionco/react-doctor",
      githubViewerPermission: null,
    });
  });

  it("returns GitHub viewer permission from the snapshot", () => {
    const layer = Git.layerOf({
      githubViewerPermission: "write",
    });
    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.githubViewerPermission({
          directory: "/repo",
          repo: "millionco/react-doctor",
        });
      }),
    );
    expect(result).toBe("write");
  });

  it("reports branch existence from the explicit map", () => {
    const layer = Git.layerOf({
      branchExists: new Map([
        ["main", true],
        ["nope", false],
      ]),
    });

    const exists = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return {
          main: yield* git.branchExists("/repo", "main"),
          nope: yield* git.branchExists("/repo", "nope"),
          unknown: yield* git.branchExists("/repo", "totally-unknown"),
        };
      }),
    );

    expect(exists).toEqual({ main: true, nope: false, unknown: false });
  });

  it("returns the snapshot's staged file list", () => {
    const layer = Git.layerOf({
      stagedFiles: ["src/a.ts", "src/b.tsx"],
    });

    const files = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.stagedFilePaths("/repo");
      }),
    );

    expect(files).toEqual(["src/a.ts", "src/b.tsx"]);
  });

  it("looks up staged content by relative path", () => {
    const layer = Git.layerOf({
      stagedContent: new Map([["src/a.ts", "export const a = 1;\n"]]),
    });

    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return {
          present: yield* git.showStagedContent("/repo", "src/a.ts"),
          absent: yield* git.showStagedContent("/repo", "src/missing.ts"),
        };
      }),
    );

    expect(result).toEqual({ present: "export const a = 1;\n", absent: null });
  });

  it("returns the snapshot's diff selection unchanged", () => {
    const layer = Git.layerOf({
      diffSelection: {
        currentBranch: "feature/x",
        baseBranch: "main",
        changedFiles: ["src/a.ts"],
        isCurrentChanges: false,
      },
    });

    const selection = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.diffSelection({ directory: "/repo" });
      }),
    );

    expect(selection).toEqual({
      currentBranch: "feature/x",
      baseBranch: "main",
      changedFiles: ["src/a.ts"],
      isCurrentChanges: false,
    });
  });

  it("simulates a fallback (null) grep when no matches are configured", () => {
    const layer = Git.layerOf({ grepMatches: null });

    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.grep({
          directory: "/repo",
          pattern: "TODO",
        });
      }),
    );

    expect(result).toBeNull();
  });

  it("formats grep matches into newline-delimited stdout", () => {
    const layer = Git.layerOf({
      grepMatches: ["src/a.ts", "src/b.tsx"],
    });

    const result = runWith(
      layer,
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.grep({
          directory: "/repo",
          pattern: "TODO",
        });
      }),
    );

    expect(result).toEqual({
      status: 0,
      stdout: "src/a.ts\nsrc/b.tsx\n",
    });
  });
});

describe("ReactDoctorError shapes raised by Git", () => {
  it("constructs a GitBaseBranchInvalid leaf", () => {
    const error = new ReactDoctorError({
      reason: new GitBaseBranchInvalid({ detail: "x" }),
    });
    expect(error.reason._tag).toBe("GitBaseBranchInvalid");
    expect(error.message).toContain("x");
  });

  it("constructs a GitBaseBranchMissing leaf", () => {
    const error = new ReactDoctorError({
      reason: new GitBaseBranchMissing({ branch: "release/9.9" }),
    });
    expect(error.reason._tag).toBe("GitBaseBranchMissing");
    expect(error.message).toContain("release/9.9");
  });
});

describe("Git.diffSelection — git-flag injection (CVE-2018-17456 shape)", () => {
  /**
   * Defense-in-depth regression for `--diff <evil>`: the service
   * MUST reject suspicious refnames BEFORE forwarding them to
   * `git rev-parse --verify` / `git merge-base`, where a leading
   * `-` would be interpreted as a git option (e.g.
   * `--upload-pack=evil`). Composite-action callers also guard with
   * `case "$DIFF_BASE" in -*)`, but the library boundary owns the
   * library boundary.
   *
   * `A..B` / `A...B` ranges ARE supported now, but the guard still
   * holds per-endpoint: a range can't smuggle an option past the check
   * via either side (`main..--upload-pack=evil`).
   *
   * Tests use `Git.layerNode` (production layer) because the
   * validation runs BEFORE any subprocess spawn — the test never
   * reaches `ChildProcess.spawn` so no `git` binary is required.
   */
  const expectInvalidReason = async (badRef: string) => {
    const program = Effect.gen(function* () {
      const git = yield* Git;
      return yield* git.diffSelection({ directory: "/repo", explicitBaseBranch: badRef });
    });
    // `Effect.flip` swaps channels: a validation failure resolves the
    // promise with the error so we can assert its tag, while an
    // unexpected success would reject (failing the test).
    const error = await Effect.runPromise(program.pipe(Effect.provide(Git.layerNode), Effect.flip));
    expect(error).toBeInstanceOf(ReactDoctorError);
    expect(error.reason._tag).toBe("GitBaseBranchInvalid");
  };

  it("rejects a leading dash (git option-injection shape)", async () => {
    await expectInvalidReason("--upload-pack=evil");
  });

  it("rejects a range endpoint that looks like a git option", async () => {
    await expectInvalidReason("main..--upload-pack=evil");
    await expectInvalidReason("--upload-pack=evil..main");
  });

  it("rejects a range endpoint carrying a reflog suffix", async () => {
    await expectInvalidReason("main..feature@{upstream}");
  });

  it("rejects a degenerate range with no commits", async () => {
    await expectInvalidReason("..");
    await expectInvalidReason("...");
  });

  it("rejects refnames containing `@{` (reflog suffix)", async () => {
    await expectInvalidReason("main@{1}");
  });

  it("rejects refnames containing spaces or shell metacharacters", async () => {
    await expectInvalidReason("main; rm -rf /");
  });

  it("rejects refnames starting with a dot", async () => {
    await expectInvalidReason(".main");
  });

  it("rejects empty refnames (legacy contract)", async () => {
    await expectInvalidReason("");
  });
});
