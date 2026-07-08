import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoUseServerInHandler } from "./tanstack-start-no-use-server-in-handler.js";

describe("tanstack-start/tanstack-start-no-use-server-in-handler — regressions", () => {
  it("flags a 'use server' directive inside a createServerFn handler", () => {
    const result = runRule(
      tanstackStartNoUseServerInHandler,
      `const getData = createServerFn().handler(async () => {
        "use server";
        return loadData();
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"use server"');
  });

  it("stays silent on a handler without the directive", () => {
    const result = runRule(
      tanstackStartNoUseServerInHandler,
      `const getData = createServerFn().handler(async () => loadData());`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
