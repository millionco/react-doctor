import { describe, expect, it } from "vite-plus/test";
import { deadCodeMaySurfaceWhenWarningsHidden } from "../src/utils/dead-code-may-surface.js";
import type { ReactDoctorConfig } from "../src/types/index.js";

const configOf = (config: Partial<ReactDoctorConfig>): ReactDoctorConfig =>
  config as ReactDoctorConfig;

describe("deadCodeMaySurfaceWhenWarningsHidden", () => {
  it("is false with no config or no severity overrides", () => {
    expect(deadCodeMaySurfaceWhenWarningsHidden(null)).toBe(false);
    expect(deadCodeMaySurfaceWhenWarningsHidden(configOf({}))).toBe(false);
  });

  it("is true when the Maintainability category is restamped to warn or error", () => {
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(configOf({ categories: { Maintainability: "error" } })),
    ).toBe(true);
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(configOf({ categories: { Maintainability: "warn" } })),
    ).toBe(true);
  });

  it("is true when a deslop rule is restamped to warn or error", () => {
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(
        configOf({ rules: { "deslop/unused-export": "error" } }),
      ),
    ).toBe(true);
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(
        configOf({ rules: { "deslop/circular-dependency": "warn" } }),
      ),
    ).toBe(true);
  });

  it("is false when the override suppresses or targets unrelated rules/categories", () => {
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(configOf({ categories: { Maintainability: "off" } })),
    ).toBe(false);
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(configOf({ rules: { "deslop/unused-export": "off" } })),
    ).toBe(false);
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(configOf({ categories: { Performance: "error" } })),
    ).toBe(false);
    expect(
      deadCodeMaySurfaceWhenWarningsHidden(
        configOf({ rules: { "react-doctor/no-array-index-key": "error" } }),
      ),
    ).toBe(false);
  });
});
