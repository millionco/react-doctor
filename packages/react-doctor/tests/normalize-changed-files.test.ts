import { describe, expect, it } from "vite-plus/test";
import { normalizeChangedFiles } from "../../../scripts/normalize-changed-files.mjs";

// Shared by the action's local-`git diff` path and its GitHub-API fallback —
// the prefix-stripping/scoping is the bug-prone bit (the `UI/UI/src/...`
// double-prefix that misses every base read), so lock it.
describe("normalizeChangedFiles", () => {
  it("passes repo-root paths through unchanged when scanning the repo root", () => {
    expect(normalizeChangedFiles(["src/a.tsx", "src/b.ts"], ".")).toEqual([
      "src/a.tsx",
      "src/b.ts",
    ]);
    expect(normalizeChangedFiles(["src/a.tsx"], undefined)).toEqual(["src/a.tsx"]);
  });

  it("strips the scanned directory prefix so a subdirectory scan stays scan-relative", () => {
    expect(normalizeChangedFiles(["UI/src/a.tsx", "UI/src/b.ts"], "UI")).toEqual([
      "src/a.tsx",
      "src/b.ts",
    ]);
  });

  it("drops files outside the scanned directory", () => {
    expect(normalizeChangedFiles(["UI/src/a.tsx", "server/x.ts", "README.md"], "UI")).toEqual([
      "src/a.tsx",
    ]);
  });

  it("normalizes a `./UI/` style directory input", () => {
    expect(normalizeChangedFiles(["UI/src/a.tsx"], "./UI/")).toEqual(["src/a.tsx"]);
  });

  it("does NOT double-prefix (the UI/UI bug): a path already scan-relative is dropped, not kept", () => {
    // A file passed as `src/a.tsx` (already scan-relative) when directory is `UI`
    // is outside the `UI/` prefix and correctly dropped — the inverse of the bug
    // where it would survive and become an unreadable `UI/src/a.tsx` lookup.
    expect(normalizeChangedFiles(["src/a.tsx"], "UI")).toEqual([]);
  });

  it("trims whitespace and drops blank lines (raw `git diff` stdin)", () => {
    expect(normalizeChangedFiles(["  src/a.tsx  ", "", "  ", "src/b.ts"], ".")).toEqual([
      "src/a.tsx",
      "src/b.ts",
    ]);
  });
});
