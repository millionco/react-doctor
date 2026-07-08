import { describe, expect, it } from "vite-plus/test";
import {
  NEXTJS_RULES,
  PREACT_RULES,
  REACT_NATIVE_RULES,
  RECOMMENDED_RULES,
  TANSTACK_QUERY_RULES,
  TANSTACK_START_RULES,
} from "oxlint-plugin-react-doctor";
import eslintPlugin from "../src/index.js";

describe("eslint-plugin-react-doctor", () => {
  it("exports the expected plugin shape", () => {
    expect(eslintPlugin.meta.name).toBe("react-doctor");
    expect(Object.keys(eslintPlugin.rules).length).toBeGreaterThan(0);
    expect(Object.keys(eslintPlugin.configs).sort()).toEqual([
      "all",
      "next",
      "preact",
      "react-native",
      "recommended",
      "tanstack-query",
      "tanstack-start",
    ]);
  });

  it("self-registers each flat config under the react-doctor namespace", () => {
    for (const flatConfig of Object.values(eslintPlugin.configs)) {
      expect(flatConfig.plugins["react-doctor"]).toBe(eslintPlugin);
    }
  });

  it("mirrors oxlint preset rule maps", () => {
    expect(eslintPlugin.configs.recommended.rules).toEqual(RECOMMENDED_RULES);
    expect(eslintPlugin.configs.next.rules).toEqual(NEXTJS_RULES);
    expect(eslintPlugin.configs["react-native"].rules).toEqual(REACT_NATIVE_RULES);
    expect(eslintPlugin.configs["tanstack-start"].rules).toEqual(TANSTACK_START_RULES);
    expect(eslintPlugin.configs["tanstack-query"].rules).toEqual(TANSTACK_QUERY_RULES);
    expect(eslintPlugin.configs.preact.rules).toEqual(PREACT_RULES);
  });

  it("only references wrapped rule ids from presets", () => {
    for (const flatConfig of Object.values(eslintPlugin.configs)) {
      for (const ruleKey of Object.keys(flatConfig.rules)) {
        const ruleName = ruleKey.replace(/^react-doctor\//, "");
        expect(eslintPlugin.rules[ruleName]).toBeDefined();
      }
    }
  });
});
