import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { reconstructSession, resolveEditPaths } from "../src/stats/reconstruct-files.js";
import type { AgentSession, FileEdit } from "../src/stats/types.js";

const CWD = "/repo";

const session = (overrides: Partial<AgentSession>): AgentSession => ({
  provider: "claude",
  sessionId: "s1",
  transcriptPath: "/tmp/s1.jsonl",
  model: "test-model",
  cwd: CWD,
  edits: [],
  reads: [],
  ...overrides,
});

// Mirror reconstruct-files.ts' resolveAgainstCwd so expectations match the
// platform-normalized paths the reconstruction emits (backslashes on Windows).
const resolved = (rawPath: string): string =>
  path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(CWD, rawPath);

const byPath = (files: ReadonlyArray<{ absolutePath: string; content: string }>) =>
  new Map(files.map((file) => [file.absolutePath, file.content]));

describe("reconstructSession", () => {
  it("uses Claude post-edit result content as the authoritative final state", () => {
    const edits: FileEdit[] = [
      { kind: "write", path: "/repo/src/a.ts", content: "export const a = 0;\n" },
      { kind: "write", path: "/repo/src/a.ts", resultContent: "export const a = 1;\n" },
    ];
    const result = reconstructSession(session({ edits }));
    expect(byPath(result.files).get(resolved("/repo/src/a.ts"))).toBe("export const a = 1;\n");
    expect(result.unreconstructable).toEqual([]);
  });

  it("replays a Cursor write then StrReplace into final content", () => {
    const edits: FileEdit[] = [
      { kind: "write", path: "/repo/src/b.ts", content: "const x = 1;\n" },
      { kind: "replace", path: "/repo/src/b.ts", oldString: "1", newString: "2" },
    ];
    const result = reconstructSession(session({ provider: "cursor", edits }));
    expect(byPath(result.files).get(resolved("/repo/src/b.ts"))).toBe("const x = 2;\n");
  });

  it("flags a StrReplace with no in-session base as unreconstructable", () => {
    const edits: FileEdit[] = [
      { kind: "replace", path: "/repo/src/c.ts", oldString: "a", newString: "b" },
    ];
    const result = reconstructSession(session({ provider: "cursor", edits }));
    expect(result.files).toEqual([]);
    expect(result.unreconstructable).toEqual([resolved("/repo/src/c.ts")]);
  });

  it("drops a StrReplace whose oldString is absent from the base rather than linting stale content", () => {
    const edits: FileEdit[] = [
      { kind: "write", path: "/repo/src/r.ts", content: "const x = 1;\n" },
      { kind: "replace", path: "/repo/src/r.ts", oldString: "does-not-exist", newString: "y" },
    ];
    const result = reconstructSession(session({ provider: "cursor", edits }));
    expect(result.files).toEqual([]);
    expect(result.unreconstructable).toEqual([resolved("/repo/src/r.ts")]);
  });

  it("reconstructs a Codex apply_patch Add File", () => {
    const patch =
      "*** Begin Patch\n*** Add File: /repo/src/d.ts\n+export const d = 1;\n*** End Patch";
    const result = reconstructSession(
      session({ provider: "codex", edits: [{ kind: "patch", path: "", patch }] }),
    );
    expect(byPath(result.files).get(resolved("/repo/src/d.ts"))).toBe("export const d = 1;\n");
  });

  it("applies a Codex apply_patch Update File on an in-session base", () => {
    const add =
      "*** Begin Patch\n*** Add File: /repo/src/e.ts\n+const value = 1;\n+export default value;\n*** End Patch";
    const update =
      "*** Begin Patch\n*** Update File: /repo/src/e.ts\n@@\n-const value = 1;\n+const value = 2;\n export default value;\n*** End Patch";
    const result = reconstructSession(
      session({
        provider: "codex",
        edits: [
          { kind: "patch", path: "", patch: add },
          { kind: "patch", path: "", patch: update },
        ],
      }),
    );
    expect(byPath(result.files).get(resolved("/repo/src/e.ts"))).toBe(
      "const value = 2;\nexport default value;\n",
    );
  });

  it("flags an apply_patch Update whose hunk does not match the base as unreconstructable", () => {
    const add = "*** Begin Patch\n*** Add File: /repo/src/h.ts\n+const value = 1;\n*** End Patch";
    const update =
      "*** Begin Patch\n*** Update File: /repo/src/h.ts\n@@\n-const value = 999;\n+const value = 2;\n*** End Patch";
    const result = reconstructSession(
      session({
        provider: "codex",
        edits: [
          { kind: "patch", path: "", patch: add },
          { kind: "patch", path: "", patch: update },
        ],
      }),
    );
    expect(result.files).toEqual([]);
    expect(result.unreconstructable).toEqual([resolved("/repo/src/h.ts")]);
  });

  it("resolves relative edit paths against the session cwd", () => {
    const edits: FileEdit[] = [{ kind: "write", path: "src/f.ts", content: "export {};\n" }];
    const result = reconstructSession(session({ edits }));
    expect(result.files.map((file) => file.absolutePath)).toEqual([resolved("src/f.ts")]);
  });

  it("ignores files outside the lintable extension allowlist", () => {
    const edits: FileEdit[] = [
      { kind: "write", path: "/repo/README.md", content: "# hi\n" },
      { kind: "replace", path: "/repo/notes.md", oldString: "x", newString: "y" },
    ];
    const result = reconstructSession(session({ edits }));
    expect(result.files).toEqual([]);
    expect(result.unreconstructable).toEqual([]);
  });

  it("drops deleted files from both output and the coverage gap list", () => {
    const edits: FileEdit[] = [
      { kind: "write", path: "/repo/src/g.ts", content: "export {};\n" },
      { kind: "delete", path: "/repo/src/g.ts" },
    ];
    const result = reconstructSession(session({ edits }));
    expect(result.files).toEqual([]);
    expect(result.unreconstructable).toEqual([]);
  });
});

describe("resolveEditPaths", () => {
  it("collects absolute paths from plain edits and apply_patch envelopes", () => {
    const patch = "*** Begin Patch\n*** Update File: /repo/src/x.ts\n@@\n+x\n*** End Patch";
    const result = resolveEditPaths(
      session({
        edits: [
          { kind: "write", path: "src/y.ts", content: "" },
          { kind: "patch", path: "", patch },
        ],
      }),
    );
    expect(new Set(result)).toEqual(new Set([resolved("src/y.ts"), resolved("/repo/src/x.ts")]));
  });
});
