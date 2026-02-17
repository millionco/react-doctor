import { describe, expect, it } from "vitest";
import { createOxlintConfig } from "../src/oxlint-config.js";

const WEB_ONLY_ROBLOX_DISABLED_RULES = [
  "react-doctor/no-layout-property-animation",
  "react-doctor/rendering-animate-svg-wrapper",
  "react-doctor/rendering-hydration-no-flicker",
  "react-doctor/no-transition-all",
  "react-doctor/no-global-css-variable-animation",
  "react-doctor/no-large-animated-blur",
  "react-doctor/no-scale-from-zero",
  "react-doctor/no-permanent-will-change",
  "react-doctor/no-prevent-default",
  "react-doctor/client-passive-event-listeners",
  "react-doctor/server-auth-actions",
  "react-doctor/server-after-nonblocking",
  "react-doctor/no-secrets-in-client-code",
  "react-doctor/use-lazy-motion",
  "react-doctor/no-undeferred-third-party",
  "react-doctor/js-batch-dom-css",
  "react-doctor/js-cache-storage",
  "react/no-unknown-property",
  "react/jsx-no-script-url",
];

describe("createOxlintConfig", () => {
  it("builds a roblox-ts profile without jsx-a11y plugin", () => {
    const robloxConfig = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      framework: "roblox-ts",
      hasReactCompiler: false,
    });

    expect(robloxConfig.plugins).not.toContain("jsx-a11y");
  });

  it("disables web-only rules in roblox-ts profile", () => {
    const robloxConfig = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      framework: "roblox-ts",
      hasReactCompiler: false,
    });

    for (const ruleName of WEB_ONLY_ROBLOX_DISABLED_RULES) {
      expect(robloxConfig.rules[ruleName]).toBe("off");
    }
  });

  it("keeps core React and state rules enabled in roblox-ts profile", () => {
    const robloxConfig = createOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      framework: "roblox-ts",
      hasReactCompiler: false,
    });

    expect(robloxConfig.rules["react/rules-of-hooks"]).toBe("error");
    expect(robloxConfig.rules["react-doctor/no-derived-useState"]).toBe("warn");
    expect(robloxConfig.rules["react-doctor/no-fetch-in-effect"]).toBe("error");
  });
});
