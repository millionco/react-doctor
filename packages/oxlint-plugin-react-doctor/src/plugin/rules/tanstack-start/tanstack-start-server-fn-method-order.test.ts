import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartServerFnMethodOrder } from "./tanstack-start-server-fn-method-order.js";

describe("tanstack-start/server-fn-method-order", () => {
  it("does not flag .validator() chained before .handler()", () => {
    const result = runRule(
      tanstackStartServerFnMethodOrder,
      `createServerFn({ method: "POST" })
        .validator((input) => input)
        .handler(async ({ data }) => data);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags .validator() chained after .handler()", () => {
    const result = runRule(
      tanstackStartServerFnMethodOrder,
      `createServerFn({ method: "POST" })
        .handler(async ({ data }) => data)
        .validator((input) => input);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".validator() after .handler()");
  });

  it("flags the deprecated .inputValidator() chained after .handler()", () => {
    const result = runRule(
      tanstackStartServerFnMethodOrder,
      `createServerFn({ method: "POST" })
        .handler(async ({ data }) => data)
        .inputValidator((input) => input);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".inputValidator() after .handler()");
  });
});
