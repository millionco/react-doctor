import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartGetMutation } from "./tanstack-start-get-mutation.js";

describe("tanstack-start/tanstack-start-get-mutation — regressions", () => {
  it("flags a database mutation inside a default-GET server function handler", () => {
    const result = runRule(
      tanstackStartGetMutation,
      `const updateBundle = createServerFn().handler(async ({ data }) => {
        await db.update({ id: data.id, status: data.status });
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("db.update()");
  });

  it("stays silent when the server function declares method POST", () => {
    const result = runRule(
      tanstackStartGetMutation,
      `const updateBundle = createServerFn({ method: "POST" }).handler(async ({ data }) => {
        await db.update({ id: data.id, status: data.status });
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
