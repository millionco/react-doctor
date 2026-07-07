import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zodV4PreferTopLevelStringFormats } from "./zod-v4-prefer-top-level-string-formats.js";

describe("zod-v4-prefer-top-level-string-formats — regressions", () => {
  // Docs-validation FP wave (remix-forms schema-form.test.tsx shape): specs
  // that deliberately exercise the legacy `z.string().email()` consumer
  // shape lose coverage if "migrated" — the rule skips testlike files.
  it("stays silent in a spec exercising legacy string-format shapes", () => {
    const code = `
      import { z } from "zod";
      const schema = z.object({ email: z.string().email(), site: z.string().url() });
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code, {
      filename: "/repo/packages/remix-forms/src/schema-form.test.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags legacy string formats in production source", () => {
    const code = `
      import { z } from "zod";
      const schema = z.string().email();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code, {
      filename: "/repo/src/lib/schema.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
