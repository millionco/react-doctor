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

  it("flags a handler that destructures `{ data }` from the ctx param in the body", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().handler((ctx) => { const { data } = ctx; return db.save(data); });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a handler that aliases `ctx.data` into a body binding", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().handler((ctx) => { const input = ctx.data; return db.save(input); });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags `ctx.data` member access directly", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().handler((ctx) => db.save(ctx.data));`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a validator guards a body destructure of the ctx param", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().validator((input) => schema.parse(input)).handler((ctx) => { const { data } = ctx; return db.save(data); });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the body destructures `{ data }` from a non-param source", () => {
    const { diagnostics } = runRule(
      tanstackStartServerFnValidateInput,
      `createServerFn().handler(async (ctx) => { const { data } = await supabase.from("users").select(); return data; });`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
