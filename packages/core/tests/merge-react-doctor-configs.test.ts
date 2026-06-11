import { describe, expect, it } from "vite-plus/test";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { mergeReactDoctorConfigs } from "@react-doctor/core";

describe("mergeReactDoctorConfigs", () => {
  it("passes either side through unchanged when the other is empty", () => {
    const baseConfig: ReactDoctorConfig = { rules: { "react-doctor/no-prop-drilling": "off" } };
    const overrideConfig: ReactDoctorConfig = { verbose: true };
    expect(mergeReactDoctorConfigs(baseConfig, undefined)).toBe(baseConfig);
    expect(mergeReactDoctorConfigs(null, overrideConfig)).toBe(overrideConfig);
    expect(mergeReactDoctorConfigs(null, undefined)).toBeNull();
  });

  it("merges `rules` per key with the override winning on conflicts", () => {
    const merged = mergeReactDoctorConfigs(
      {
        rules: {
          "react-doctor/no-prop-drilling": "error",
          "react-doctor/no-array-index-as-key": "error",
        },
      },
      { rules: { "react-doctor/no-array-index-as-key": "off" } },
    );
    expect(merged?.rules).toEqual({
      "react-doctor/no-prop-drilling": "error",
      "react-doctor/no-array-index-as-key": "off",
    });
  });

  it("merges `categories` per key", () => {
    const merged = mergeReactDoctorConfigs(
      { categories: { Performance: "warn" } },
      { categories: { Maintainability: "off" } },
    );
    expect(merged?.categories).toEqual({ Performance: "warn", Maintainability: "off" });
  });

  it("unions `ignore` lists and concatenates `ignore.overrides`", () => {
    const merged = mergeReactDoctorConfigs(
      {
        ignore: {
          rules: ["react-doctor/no-prop-drilling"],
          files: ["src/legacy/**"],
          tags: ["design"],
          overrides: [{ files: ["src/old/**"] }],
        },
      },
      {
        ignore: {
          rules: ["react-doctor/no-prop-drilling", "react-doctor/no-array-index-as-key"],
          tags: ["test-noise"],
          overrides: [{ files: ["src/generated/**"] }],
        },
      },
    );
    expect(merged?.ignore).toEqual({
      rules: ["react-doctor/no-prop-drilling", "react-doctor/no-array-index-as-key"],
      files: ["src/legacy/**"],
      tags: ["design", "test-noise"],
      overrides: [{ files: ["src/old/**"] }, { files: ["src/generated/**"] }],
    });
  });

  it("merges `supplyChain` per field", () => {
    const merged = mergeReactDoctorConfigs(
      { supplyChain: { enabled: true } },
      { supplyChain: { severity: "warning" } },
    );
    expect(merged?.supplyChain).toEqual({ enabled: true, severity: "warning" });
  });

  it("overrides scalar fields when set and keeps base scalars otherwise", () => {
    const merged = mergeReactDoctorConfigs({ deadCode: true, verbose: true }, { deadCode: false });
    expect(merged?.deadCode).toBe(false);
    expect(merged?.verbose).toBe(true);
  });
});
