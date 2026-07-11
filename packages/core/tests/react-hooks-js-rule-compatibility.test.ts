import { createRequire } from "node:module";
import { REACT_COMPILER_RULES } from "oxlint-plugin-react-doctor";
import { describe, expect, it } from "vite-plus/test";
import { filterRulesToAvailable } from "../src/runners/oxlint/plugin-resolution.js";

const esmRequire = createRequire(import.meta.url);

describe("react-hooks-js rule compatibility", () => {
  it("keeps every configured compiler rule available in the installed plugin", () => {
    const reactHooksPlugin = esmRequire("eslint-plugin-react-hooks");
    const availableRuleNames = new Set(Object.keys(reactHooksPlugin.rules));
    const configuredRuleNames = Object.keys(REACT_COMPILER_RULES).map((ruleKey) =>
      ruleKey.slice(ruleKey.indexOf("/") + 1),
    );

    expect(configuredRuleNames.filter((ruleName) => !availableRuleNames.has(ruleName))).toEqual([]);
  });

  it("drops configured rules missing from an older plugin version", () => {
    const filteredRules = filterRulesToAvailable(
      REACT_COMPILER_RULES,
      "react-hooks-js",
      new Set(["refs"]),
    );

    expect(filteredRules).toEqual({
      "react-hooks-js/refs": REACT_COMPILER_RULES["react-hooks-js/refs"],
    });
  });
});
