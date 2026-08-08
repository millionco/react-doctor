import { describe, expect, it } from "vite-plus/test";
import {
  CODE_FRAME_BATCH_MAX_SPAN_LINES,
  MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE,
  MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
  OUTPUT_DETAIL_WRAP_WIDTH_CHARS,
  type AutoScanConcurrencyFacts,
  resolveAutoScanConcurrency,
} from "@react-doctor/core";

describe("public API compatibility", () => {
  it("retains output constants", () => {
    expect(MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE).toBe(5);
    expect(MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE).toBe(3);
    expect(CODE_FRAME_BATCH_MAX_SPAN_LINES).toBe(20);
    expect(OUTPUT_DETAIL_WRAP_WIDTH_CHARS).toBe(88);
  });

  it("retains AutoScanConcurrencyFacts", () => {
    const facts: AutoScanConcurrencyFacts = {
      availableCores: 4,
      totalMemoryBytes: 4 * 1024 * 1024 * 1024,
      cgroupMemoryLimitBytes: undefined,
    };
    expect(resolveAutoScanConcurrency(facts)).toBe(4);
  });
});
