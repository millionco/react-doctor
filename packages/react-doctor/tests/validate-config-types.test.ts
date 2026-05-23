import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { validateConfigTypes } from "@react-doctor/core";

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
      verbose: {} as unknown as boolean,
    });
    expect(result.lint).toBeUndefined();
    expect(result.verbose).toBeUndefined();
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

  describe("surfaces", () => {
    it("passes through a well-formed surfaces config untouched", () => {
      const input: ReactDoctorConfig = {
        surfaces: {
          prComment: { includeTags: ["design"], excludeCategories: ["Performance"] },
          ciFailure: { excludeRules: ["react-doctor/no-vague-button-label"] },
        },
      };
      expect(validateConfigTypes(input)).toEqual(input);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("drops unknown surface keys with a stderr warning", () => {
      const result = validateConfigTypes({
        surfaces: {
          prComment: { excludeTags: ["design"] },
          dashboard: { excludeTags: ["foo"] },
        } as unknown as ReactDoctorConfig["surfaces"],
      });
      expect(result.surfaces).toEqual({ prComment: { excludeTags: ["design"] } });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("dashboard"));
    });

    it("strips non-string entries from include/exclude arrays", () => {
      const result = validateConfigTypes({
        surfaces: {
          score: {
            excludeTags: ["design", 42, null] as unknown as string[],
          },
        },
      });
      expect(result.surfaces).toEqual({ score: { excludeTags: ["design"] } });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("excludeTags"));
    });

    it("drops the entire surfaces field if it isn't an object", () => {
      const result = validateConfigTypes({
        surfaces: "all" as unknown as ReactDoctorConfig["surfaces"],
      });
      expect(result.surfaces).toBeUndefined();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("surfaces"));
    });
  });

  describe("severity (top-level rules / categories)", () => {
    it("passes through the ESLint-shaped top-level severity fields untouched", () => {
      const input: ReactDoctorConfig = {
        rules: { "react-doctor/no-array-index-as-key": "error" },
        categories: { "React Native": "warn" },
      };
      expect(validateConfigTypes(input)).toEqual(input);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("drops invalid severity values with a stderr warning, keeping valid siblings", () => {
      const result = validateConfigTypes({
        categories: { "React Native": "loud", Server: "warn" } as unknown as Record<string, "warn">,
      });
      expect(result.categories).toEqual({ Server: "warn" });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(`categories.React Native`));
    });

    it("drops the entire rules field when it isn't an object", () => {
      const result = validateConfigTypes({
        rules: "off" as unknown as ReactDoctorConfig["rules"],
      });
      expect(result.rules).toBeUndefined();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(`config field "rules"`));
    });

    it("drops arrays passed where a severity map is expected, keeping valid siblings", () => {
      const result = validateConfigTypes({
        categories: ["off"] as unknown as ReactDoctorConfig["categories"],
        rules: { "react-doctor/no-array-index-as-key": "error" },
      });
      expect(result.categories).toBeUndefined();
      expect(result.rules).toEqual({ "react-doctor/no-array-index-as-key": "error" });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(`config field "categories"`));
    });
  });
});
