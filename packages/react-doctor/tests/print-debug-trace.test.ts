import { describe, expect, it } from "vite-plus/test";
import { buildDebugTraceMessage } from "../src/cli/utils/print-debug-trace.js";

describe("buildDebugTraceMessage", () => {
  it("prints the trace id with the report-it hint when one was captured", () => {
    const message = buildDebugTraceMessage("abc123def456");
    expect(message).toContain("abc123def456");
    expect(message).toContain("mention this when reporting");
  });

  it("notes when no trace was recorded for this run", () => {
    const message = buildDebugTraceMessage(null);
    expect(message).toContain("no trace was recorded");
  });
});
