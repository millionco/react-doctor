import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zodV4PreferTopLevelStringFormats } from "./zod-v4-prefer-top-level-string-formats.js";

describe("zod-v4-prefer-top-level-string-formats", () => {
  it("flags deprecated string format methods on imported z", () => {
    const code = `
      import { z } from "zod";
      const schema = z.string().email();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags namespace import aliases and removed ip/cidr helpers", () => {
    const code = `
      import * as zod from "zod";
      const ip = zod.string().ip();
      const cidr = zod.string().cidr();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags renamed z imports", () => {
    const code = `
      import { z as schema } from "zod";
      const id = schema.string().uuid();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags named string factory imports", () => {
    const code = `
      import { string } from "zod";
      const id = string().ulid();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags default-imported Zod namespace calls", () => {
    const code = `
      import z from "zod";
      const schema = z.string().url();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags static computed format names", () => {
    const code = `
      import { z } from "zod";
      const schema = z.string()["email"]();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags through transparent TS and parenthesis wrappers", () => {
    const code = `
      import { z } from "zod";
      const schema = ((z as typeof z)).string().uuid();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag same-looking non-Zod string builders", () => {
    const code = `
      const z = createValidator();
      const schema = z.string().email();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag shadowed Zod imports", () => {
    const code = `
      import { z } from "zod";
      function build(z) {
        return z.string().email();
      }
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag dynamic computed format names", () => {
    const code = `
      import { z } from "zod";
      const method = "email";
      const schema = z.string()[method]();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag type-flow aliases of schemas in v1", () => {
    const code = `
      import { z } from "zod";
      const stringSchema = z.string();
      const email = stringSchema.email();
    `;
    const result = runRule(zodV4PreferTopLevelStringFormats, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
