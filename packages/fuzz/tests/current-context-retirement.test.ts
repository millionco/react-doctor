import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { noAdjustStateOnPropChange } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-adjust-state-on-prop-change.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { MODULE_SCOPE_SNIPPET_POOL } from "../src/snippet-pools.js";

const fixturePath = fileURLToPath(
  new URL(
    "../corpus/regressions/no-adjust-state-on-prop-change--context-masked-retirement.tsx",
    import.meta.url,
  ),
);
const fixture = readFileSync(fixturePath, "utf8");

describe("current-context retirement generator and corpus", () => {
  it("preserves the synthetic masked retirement corpus", () => {
    const result = runRule(noAdjustStateOnPropChange, fixture, { filename: fixturePath });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("checks the imported pool entry and its unmasked reporting inverse", () => {
    const snippets = MODULE_SCOPE_SNIPPET_POOL.filter((snippet) =>
      snippet.includes("export const FuzzTokenRetirementNotice ="),
    );
    expect(snippets).toHaveLength(1);
    const [snippet] = snippets;
    if (!snippet) throw new Error("Missing current-context retirement snippet");
    const masked = runRule(noAdjustStateOnPropChange, snippet, { filename: fixturePath });
    const unmasked = runRule(
      noAdjustStateOnPropChange,
      snippet.replace(
        "const message = matches ? notice?.message : undefined;",
        "const message = notice?.message;",
      ),
      { filename: fixturePath },
    );
    expect(masked.parseErrors).toEqual([]);
    expect(unmasked.parseErrors).toEqual([]);
    expect(masked.diagnostics).toEqual([]);
    expect(unmasked.diagnostics).toHaveLength(1);
  });
});
