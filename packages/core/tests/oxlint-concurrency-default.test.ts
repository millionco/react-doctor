/**
 * Guards the "parallel by default" contract: with no `REACT_DOCTOR_PARALLEL`
 * override, the `OxlintConcurrency` Reference resolves to auto-detected CPU
 * cores (parallel), not `1` (serial).
 *
 * The Reference caches its `defaultValue` on first access, so this asserts a
 * single read with the env var cleared beforehand — enough to catch a
 * regression back to a serial default (cores > 1 on CI).
 */

import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { OxlintConcurrency, resolveScanConcurrency } from "@react-doctor/core";

describe("OxlintConcurrency default", () => {
  it("defaults to auto-detected cores (parallel) when REACT_DOCTOR_PARALLEL is unset", () => {
    delete process.env.REACT_DOCTOR_PARALLEL;
    expect(Effect.runSync(OxlintConcurrency)).toBe(resolveScanConcurrency("auto"));
  });
});
