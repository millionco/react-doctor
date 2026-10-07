import { describe, expect, it } from "vite-plus/test";
import { computeSourceFilterConfigHash } from "../src/cli/utils/compute-source-filter-config-hash.js";

describe("computeSourceFilterConfigHash", () => {
  it("treats component names as sets and ignores portable filters", () => {
    expect(
      computeSourceFilterConfigHash({
        userConfig: {
          textComponents: ["Label", "Text", "Label"],
          rawTextWrapperComponents: ["Button"],
          ignore: { rules: ["react-hooks/exhaustive-deps"] },
        },
        respectInlineDisables: false,
      }),
    ).toBe(
      computeSourceFilterConfigHash({
        userConfig: { textComponents: ["Text", "Label"], rawTextWrapperComponents: ["Button"] },
        respectInlineDisables: false,
      }),
    );
  });

  it("normalizes absent lists and distinguishes source filter settings", () => {
    const defaultHash = computeSourceFilterConfigHash({
      userConfig: null,
      respectInlineDisables: false,
    });
    expect(
      computeSourceFilterConfigHash({
        userConfig: { textComponents: [], rawTextWrapperComponents: [] },
        respectInlineDisables: false,
      }),
    ).toBe(defaultHash);
    for (const userConfig of [
      { textComponents: ["Label"] },
      { rawTextWrapperComponents: ["Button"] },
    ]) {
      expect(computeSourceFilterConfigHash({ userConfig, respectInlineDisables: false })).not.toBe(
        defaultHash,
      );
    }
    expect(
      computeSourceFilterConfigHash({ userConfig: null, respectInlineDisables: true }),
    ).not.toBe(defaultHash);
  });
});
