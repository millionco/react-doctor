import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { NON_FULL_ZOD_V4_MODULE_SOURCES } from "./__fixtures__/non-full-zod-v4-module-sources.js";
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

  it.each([
    { importStatement: 'import { z } from "zod/v4";', factoryExpression: "z.string" },
    { importStatement: 'import * as schema from "zod/v4";', factoryExpression: "schema.string" },
    {
      importStatement: 'import { z as schema } from "zod/v4";',
      factoryExpression: "schema.string",
    },
    { importStatement: 'import schema from "zod/v4";', factoryExpression: "schema.string" },
    {
      importStatement: 'import { string as createString } from "zod/v4";',
      factoryExpression: "createString",
    },
  ])(
    "flags legacy string formats from the official v4 export: $importStatement",
    ({ importStatement, factoryExpression }) => {
      const code = `
        ${importStatement}
        const schemaValue = ${factoryExpression}().email();
      `;
      const result = runRule(zodV4PreferTopLevelStringFormats, code, {
        filename: "/repo/src/lib/schema.ts",
      });
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(NON_FULL_ZOD_V4_MODULE_SOURCES)(
    "does NOT assign the full Zod v4 API to %s",
    (moduleSource) => {
      const code = `
        import { z } from "${moduleSource}";
        const schema = z.string().email();
      `;
      const result = runRule(zodV4PreferTopLevelStringFormats, code, {
        filename: "/repo/src/lib/schema.ts",
      });
      expect(result.diagnostics).toHaveLength(0);
    },
  );
});
