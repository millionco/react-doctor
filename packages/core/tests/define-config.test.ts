import { describe, expect, it } from "vite-plus/test";
import { defineConfig } from "@react-doctor/core";

describe("defineConfig", () => {
  it("returns the config object untouched", () => {
    const config = {
      lint: true,
      rules: { "react-doctor/no-array-index-as-key": "off" },
    } as const;
    expect(defineConfig(config)).toBe(config);
  });
});
