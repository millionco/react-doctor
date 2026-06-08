import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zodV4NoDeprecatedSchemaApis } from "./zod-v4-no-deprecated-schema-apis.js";

describe("zod-v4-no-deprecated-schema-apis", () => {
  it("flags deprecated object helpers", () => {
    const code = `
      import { z } from "zod";
      const strict = z.object({}).strict();
      const pass = z.object({}).passthrough();
      const merged = z.object({ a: z.string() }).merge(z.object({ b: z.string() }));
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics[0].message).toContain("changed in Zod 4");
    expect(result.diagnostics[0].message).not.toContain("removed");
  });

  it("flags Better Auth-style object strict schemas", () => {
    const code = `
      import { z } from "zod";
      export const bodySchema = z
        .object({
          name: z.string().min(1),
          email: z.string().email(),
        })
        .strict();
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags deprecated top-level factories and optional aliases", () => {
    const code = `
      import * as z from "zod";
      const native = z.nativeEnum(Role);
      const promised = z.promise(z.string());
      const optional = z.ostring();
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags named imports for deprecated factories", () => {
    const code = `
      import { nativeEnum, promise } from "zod";
      const native = nativeEnum(Role);
      const promised = promise();
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags aliased named imports for deprecated factories", () => {
    const code = `
      import { nativeEnum as enumFromNative, ostring as optionalString } from "zod";
      const native = enumFromNative(Role);
      const optional = optionalString();
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags default-imported namespace factories", () => {
    const code = `
      import z from "zod";
      const legacy = z.promise(z.string());
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags dropped create factories, one-argument record, and enum aliases", () => {
    const code = `
      import { z } from "zod";
      const legacy = z.string.create();
      const rec = z.record(z.string());
      const values = z.enum(["a", "b"]).Enum;
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags static computed properties for deprecated members", () => {
    const code = `
      import { z } from "zod";
      const strict = z.object({})["strict"]();
      const values = z.enum(["a", "b"])["Values"];
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not double-report callee member expressions", () => {
    const code = `
      import { z } from "zod";
      const legacy = z.string.create();
      const formatted = z.enum(["a"]).Enum;
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags old function schema chain and symbol literals", () => {
    const code = `
      import { z } from "zod";
      const fn = z.function().args(z.string()).returns(z.number());
      const symbolLiteral = z.literal(Symbol("x"));
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags deprecated safe number helper and refine function second argument", () => {
    const code = `
      import { z } from "zod";
      const safe = z.number().safe();
      const refined = z.string().refine(Boolean, () => ({ message: "Nope" }));
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does NOT flag retained Langfuse-style z.number().int() chains", () => {
    const code = `
      import { z } from "zod";
      const score = z.number().int().nonnegative();
      const count = z.number().int().min(0).max(100);
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags symbol member literals", () => {
    const code = `
      import { z } from "zod";
      const iteratorLiteral = z.literal(Symbol.iterator);
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag modern Zod 4 replacements", () => {
    const code = `
      import { z } from "zod";
      const strict = z.strictObject({});
      const native = z.enum(Role);
      const rec = z.record(z.string(), z.number());
      const fn = z.function({ input: [z.string()], output: z.number() });
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag non-Zod lookalikes or dynamic properties", () => {
    const code = `
      import { z as schema } from "zod";
      const localZ = createValidator();
      const strict = localZ.object({}).strict();
      const method = "strict";
      const dynamic = schema.object({})[method]();
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag type-flow aliases of schemas in v1", () => {
    const code = `
      import { z } from "zod";
      const objectSchema = z.object({});
      const strict = objectSchema.strict();
      const numberSchema = z.number();
      const safe = numberSchema.safe();
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag refine callback options object or modern error callback", () => {
    const code = `
      import { z } from "zod";
      const refined = z.string().refine(Boolean, { error: "Nope" });
      const transformed = z.string().refine(Boolean);
    `;
    const result = runRule(zodV4NoDeprecatedSchemaApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
