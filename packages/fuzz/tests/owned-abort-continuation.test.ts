import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { noSetStateAfterAwaitInEffect } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-set-state-after-await-in-effect.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { MODULE_SCOPE_SNIPPET_POOL } from "../src/snippet-pools.js";

describe("owned abort continuation corpus and generator", () => {
  it.each([
    { file: "no-set-state-after-await-in-effect--unguarded-owned-abort.tsx", count: 1 },
    { file: "no-set-state-after-await-in-effect--fresh-owned-abort-guard.tsx", count: 0 },
  ])("preserves $file", ({ file, count }) => {
    const code = readFileSync(new URL(`../corpus/regressions/${file}`, import.meta.url), "utf8");
    const result = runRule(noSetStateAfterAwaitInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });

  it("keeps a reporting module-level generator snippet", () => {
    const snippets = MODULE_SCOPE_SNIPPET_POOL.filter((snippet) =>
      snippet.includes("const FuzzOwnedAbortContinuation ="),
    );
    expect(snippets).toHaveLength(1);
    const [snippet] = snippets;
    if (!snippet) throw new Error("Missing owned abort continuation snippet");
    const result = runRule(noSetStateAfterAwaitInEffect, snippet);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
