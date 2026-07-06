import { describe, expect, it } from "vite-plus/test";
import { hasIgnoredPathSegment } from "../src/utils/has-ignored-path-segment.js";

describe("hasIgnoredPathSegment", () => {
  it("flags build-output directories anywhere in the path", () => {
    expect(hasIgnoredPathSegment("ai/dist/mcp-server.js")).toBe(true);
    expect(hasIgnoredPathSegment("dist/index.js")).toBe(true);
    expect(hasIgnoredPathSegment("packages/app/build/main.tsx")).toBe(true);
    expect(hasIgnoredPathSegment("out/page.jsx")).toBe(true);
    expect(hasIgnoredPathSegment(".next/server/app.js")).toBe(true);
    expect(hasIgnoredPathSegment("node_modules/react/index.js")).toBe(true);
  });

  // The disable-directive filesystem walk feeds raw `path.relative` output,
  // which is backslash-separated on Windows — so build output must still be
  // excluded there, not just on the forward-slash git paths.
  it("flags build-output directories in backslash-separated paths", () => {
    expect(hasIgnoredPathSegment("ai\\dist\\mcp-server.js")).toBe(true);
    expect(hasIgnoredPathSegment("src\\components\\app.tsx")).toBe(false);
  });

  it("ignores the filename segment", () => {
    expect(hasIgnoredPathSegment("src/dist")).toBe(false);
    expect(hasIgnoredPathSegment("build")).toBe(false);
  });

  it("does not flag directories that merely contain an ignored name", () => {
    expect(hasIgnoredPathSegment("distribution/app.tsx")).toBe(false);
    expect(hasIgnoredPathSegment("src/builder/app.tsx")).toBe(false);
    expect(hasIgnoredPathSegment(".dumi/hooks/use-local-storage.ts")).toBe(false);
  });

  // Issue: `git ls-files` listed tracked agent-tooling scripts under
  // `.codex/skills/**`, so oxlint flagged them (83 `no-console` FPs on one
  // repo) even though hidden tool directories are not app code.
  it("flags hidden dot-directories that are not on the scanned allowlist", () => {
    expect(hasIgnoredPathSegment(".codex/skills/translate/scripts/check.mjs")).toBe(true);
    expect(hasIgnoredPathSegment(".claude/commands/review.mjs")).toBe(true);
    expect(hasIgnoredPathSegment(".cursor/rules/generate.mjs")).toBe(true);
    expect(hasIgnoredPathSegment(".github/scripts/release.mjs")).toBe(true);
    expect(hasIgnoredPathSegment("packages/app/.agents/skills/run.mjs")).toBe(true);
  });

  it("keeps allowlisted dot-directories scannable", () => {
    expect(hasIgnoredPathSegment(".dumi/pages/banner.tsx")).toBe(false);
    expect(hasIgnoredPathSegment(".storybook/preview.tsx")).toBe(false);
  });

  it("does not flag hidden files at any level (only directories)", () => {
    expect(hasIgnoredPathSegment(".eslintrc.js")).toBe(false);
    expect(hasIgnoredPathSegment("src/.hidden-helper.ts")).toBe(false);
  });
});
