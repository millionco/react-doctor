import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxPascalCase } from "./jsx-pascal-case.js";

interface NamingMessageCase {
  name: string;
  code: string;
  ruleSettings?: Readonly<Record<string, unknown>>;
  expectedMessages: ReadonlyArray<string>;
}

const namingMessageCases: ReadonlyArray<NamingMessageCase> = [
  {
    name: "explains the all-caps naming preference without a runtime claim",
    code: "<NOTICE />",
    expectedMessages: [
      "Component `NOTICE` does not follow the configured PascalCase naming convention.",
    ],
  },
  {
    name: "explains a non-PascalCase member spelling",
    code: "<Panel.bad_name />",
    expectedMessages: [
      "Component `bad_name` does not follow the configured PascalCase naming convention.",
    ],
  },
  {
    name: "names both conventions when all caps are allowed",
    code: "<Bad_Name />",
    ruleSettings: {
      allowAllCaps: true,
    },
    expectedMessages: [
      "Component `Bad_Name` does not follow the configured PascalCase or SCREAMING_SNAKE_CASE naming convention.",
    ],
  },
  {
    name: "retains the configured all-caps exception",
    code: "<NOTICE />",
    ruleSettings: {
      allowAllCaps: true,
    },
    expectedMessages: [],
  },
  {
    name: "retains ordinary PascalCase names",
    code: "<Panel />",
    expectedMessages: [],
  },
  {
    name: "retains native lowercase names",
    code: "<span />",
    expectedMessages: [],
  },
  {
    name: "retains exact ignored names",
    code: "<NOTICE />",
    ruleSettings: {
      ignore: ["NOTICE"],
    },
    expectedMessages: [],
  },
  {
    name: "retains the configured namespace exception",
    code: "<Panel.bad_name />",
    ruleSettings: {
      allowNamespace: true,
    },
    expectedMessages: [],
  },
];

describe("jsx-pascal-case naming messages", () => {
  it.each(namingMessageCases)("$name", ({ code, ruleSettings = {}, expectedMessages }) => {
    const result = runRule(jsxPascalCase, code, {
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          jsxPascalCase: ruleSettings,
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expectedMessages);
  });

  it("recommends the naming policy without claiming intrinsic-tag confusion", () => {
    expect(jsxPascalCase.recommendation).toBe(
      "Use PascalCase for custom JSX component names, or configure the rule's naming exceptions.",
    );
  });
});
