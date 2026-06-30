import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartServerFnValidateInput } from "./tanstack-start-server-fn-validate-input.js";

describe("tanstack-start/tanstack-start-server-fn-validate-input — regressions", () => {
  it("stays silent when a no-input handler destructures a `{ data }` result (Supabase)", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().handler(async () => { const { data } = await supabase.from("users").select(); return data; });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a handler whose first param destructures `{ data }`", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().handler(({ data }) => data);`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
