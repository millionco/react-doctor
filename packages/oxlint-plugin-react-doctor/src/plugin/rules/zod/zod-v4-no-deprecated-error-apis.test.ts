import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zodV4NoDeprecatedErrorApis } from "./zod-v4-no-deprecated-error-apis.js";

describe("zod-v4-no-deprecated-error-apis", () => {
  it("flags ZodError.create", () => {
    const code = `
      import { z } from "zod";
      const error = z.ZodError.create([]);
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags namespace and renamed ZodError imports", () => {
    const code = `
      import * as zod from "zod";
      import { ZodError as ValidationError } from "zod";
      const namespaceErrors = new zod.ZodError([]).formErrors;
      const renamed = new ValidationError([]).format();
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags static computed deprecated ZodError members", () => {
    const code = `
      import { ZodError } from "zod";
      const flattened = new ZodError([])["flatten"]();
      const issues = new ZodError([])["errors"];
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags deprecated helpers on direct ZodError values", () => {
    const code = `
      import { ZodError } from "zod";
      const flattened = new ZodError([]).flatten();
      const formatted = ZodError.create([]).format();
      const errors = new ZodError([]).errors;
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does NOT flag unknown error-like values", () => {
    const code = `
      const error = getError();
      error.flatten();
      error.errors;
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag caught ZodError variables without type information in v1", () => {
    const code = `
      import { ZodError } from "zod";
      try {
        parseInput();
      } catch (error) {
        if (error instanceof ZodError) {
          error.flatten();
          error.errors;
        }
      }
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag non-Zod ZodError lookalikes", () => {
    const code = `
      import { ZodError } from "./errors";
      const flattened = new ZodError([]).flatten();
    `;
    const result = runRule(zodV4NoDeprecatedErrorApis, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
