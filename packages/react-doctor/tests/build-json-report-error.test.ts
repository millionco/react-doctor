import { describe, expect, it } from "vite-plus/test";
import { buildJsonReportError } from "../src/utils/build-json-report-error.js";

describe("buildJsonReportError", () => {
  it("handles non-Error values that cannot be stringified", () => {
    const error = {
      toString: () => {
        throw new Error("no string");
      },
    };

    expect(
      buildJsonReportError({
        version: "0.0.0",
        directory: "/repo",
        elapsedMilliseconds: 1,
        error,
      }).error,
    ).toEqual({
      message: "Unrepresentable error",
      name: "Error",
      chain: ["Unrepresentable error"],
    });
  });
});
