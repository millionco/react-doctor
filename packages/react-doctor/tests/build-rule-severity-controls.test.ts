import { describe, expect, it } from "vite-plus/test";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { buildRuleSeverityControls } from "@react-doctor/core";

describe("buildRuleSeverityControls", () => {
  it("returns undefined for a null config", () => {
    expect(buildRuleSeverityControls(null)).toBeUndefined();
  });

  it("returns undefined when neither `rules` nor `categories` are set", () => {
    const config: ReactDoctorConfig = { verbose: true };
    expect(buildRuleSeverityControls(config)).toBeUndefined();
  });

  it("assembles a controls object from the top-level fields", () => {
    const config: ReactDoctorConfig = {
      rules: { "react-doctor/no-array-index-as-key": "error" },
      categories: { "React Native": "warn" },
    };
    expect(buildRuleSeverityControls(config)).toEqual({
      rules: { "react-doctor/no-array-index-as-key": "error" },
      categories: { "React Native": "warn" },
    });
  });

  it("omits unset channels (doesn't fabricate empty maps)", () => {
    const config: ReactDoctorConfig = { categories: { Server: "off" } };
    expect(buildRuleSeverityControls(config)).toEqual({ categories: { Server: "off" } });
  });
});
