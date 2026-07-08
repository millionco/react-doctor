import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoDynamicServerFnImport } from "./tanstack-start-no-dynamic-server-fn-import.js";

describe("tanstack-start/tanstack-start-no-dynamic-server-fn-import — regressions", () => {
  it("flags a dynamic import of a .functions module", () => {
    const result = runRule(
      tanstackStartNoDynamicServerFnImport,
      `export const load = async () => {
  const { getUser } = await import("~/utils/users.functions");
  return getUser();
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a dynamic import of a non-server-fn module", () => {
    const result = runRule(
      tanstackStartNoDynamicServerFnImport,
      `export const load = async () => {
  const { chart } = await import("~/components/chart");
  return chart();
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
