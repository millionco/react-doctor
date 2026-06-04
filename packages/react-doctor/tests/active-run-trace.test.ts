import { afterEach, describe, expect, it } from "vite-plus/test";
import { getActiveRunTrace, setActiveRunTrace } from "../src/cli/utils/active-run-trace.js";

describe("active run trace", () => {
  afterEach(() => setActiveRunTrace(null));

  it("starts empty", () => {
    expect(getActiveRunTrace()).toBeNull();
  });

  it("stores and clears the in-flight run trace", () => {
    const trace = { traceId: "trace-1", spanId: "span-1", sampled: true };
    setActiveRunTrace(trace);
    expect(getActiveRunTrace()).toBe(trace);
    setActiveRunTrace(null);
    expect(getActiveRunTrace()).toBeNull();
  });
});
