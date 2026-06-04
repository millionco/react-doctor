import { describe, expect, it } from "vite-plus/test";
import { MIN_SCAN_CONCURRENCY } from "@react-doctor/core";
import { resolveParallelFlag } from "../src/cli/utils/resolve-parallel-flag.js";

describe("resolveParallelFlag", () => {
  it("returns undefined when the flag is absent (defers to the parallel default)", () => {
    // Commander's negatable-option default is `true` when `--no-parallel`
    // is not passed; `undefined` covers callers that omit the field.
    expect(resolveParallelFlag(true)).toBeUndefined();
    expect(resolveParallelFlag(undefined)).toBeUndefined();
  });

  it("pins serial for --no-parallel so it overrides an env-enabled default", () => {
    // `--no-parallel` (parallel === false) is an explicit opt-out: it must
    // beat a `REACT_DOCTOR_PARALLEL`-enabled default, so it resolves to a
    // concrete worker count rather than deferring (undefined).
    expect(resolveParallelFlag(false)).toBe(MIN_SCAN_CONCURRENCY);
  });
});
