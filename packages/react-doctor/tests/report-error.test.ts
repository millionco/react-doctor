import { describe, expect, it } from "vite-plus/test";
import { reportErrorToSentry } from "../src/cli/utils/report-error.js";

describe("reportErrorToSentry", () => {
  it("resolves to undefined without throwing when Sentry is not initialized (under tests)", async () => {
    await expect(reportErrorToSentry(new Error("boom"))).resolves.toBeUndefined();
  });
});
