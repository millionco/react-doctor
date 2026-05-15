import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReactDoctorConfig } from "../src/types/config.js";
import { validateConfigTypes } from "../src/core/validate-config-types.js";

// HACK: validator writes warnings directly to `process.stderr` so they
// stay visible in `--json` mode (where the logger is silenced). Spy on
// `process.stderr.write` to assert.
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe("validateConfigTypes", () => {
  it("passes through proper boolean values untouched", () => {
    const input: ReactDoctorConfig = {
      lint: true,
      deadCode: false,
      verbose: true,
      respectInlineDisables: false,
    };
    expect(validateConfigTypes(input)).toEqual(input);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('coerces the string `"true"` to boolean true and writes to stderr', () => {
    const result = validateConfigTypes({
      respectInlineDisables: "true" as unknown as boolean,
    });
    expect(result.respectInlineDisables).toBe(true);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("respectInlineDisables"));
  });

  it("passes through adoptExistingLintConfig and coerces stringy variants", () => {
    expect(validateConfigTypes({ adoptExistingLintConfig: false }).adoptExistingLintConfig).toBe(
      false,
    );
    expect(
      validateConfigTypes({ adoptExistingLintConfig: "false" as unknown as boolean })
        .adoptExistingLintConfig,
    ).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("adoptExistingLintConfig"));
  });

  it('coerces the string `"false"` to boolean false and writes to stderr', () => {
    const result = validateConfigTypes({
      respectInlineDisables: "false" as unknown as boolean,
    });
    expect(result.respectInlineDisables).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("respectInlineDisables"));
  });

  it("strips invalid types (numbers, objects) with a warning so the field falls back to the default", () => {
    const result = validateConfigTypes({
      lint: 42 as unknown as boolean,
      deadCode: {} as unknown as boolean,
    });
    expect(result.lint).toBeUndefined();
    expect(result.deadCode).toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("does not touch non-boolean fields like ignore.rules", () => {
    const input: ReactDoctorConfig = {
      ignore: { rules: ["react/no-danger"] },
      textComponents: ["MyText"],
    };
    expect(validateConfigTypes(input)).toEqual(input);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
