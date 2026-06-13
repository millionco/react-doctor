import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartServerFnValidateInput } from "./tanstack-start-server-fn-validate-input.js";

describe("tanstack-start/server-fn-validate-input", () => {
  it("flags a handler that reads data without any validation", () => {
    const result = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn({ method: "POST" }).handler(async ({ data }) => data);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("validator()");
  });

  it("does not flag a handler guarded by .validator()", () => {
    const result = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn({ method: "POST" })
        .validator((input) => input)
        .handler(async ({ data }) => data);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a handler guarded by the deprecated .inputValidator()", () => {
    const result = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn({ method: "POST" })
        .inputValidator((input) => input)
        .handler(async ({ data }) => data);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a handler that never reads data", () => {
    const result = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn({ method: "POST" }).handler(async () => ({ ok: true }));`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a handler that reads data via member access without validation", () => {
    const result = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn({ method: "POST" }).handler(async (context) => context.data);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("validator()");
  });

  it("does not flag member-access data guarded by .validator()", () => {
    const result = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn({ method: "POST" })
        .validator((input) => input)
        .handler(async (context) => context.data);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
