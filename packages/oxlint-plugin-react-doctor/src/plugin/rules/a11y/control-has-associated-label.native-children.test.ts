import { describe, expect, it } from "vite-plus/test";
import { runRule, type RunRuleOptions } from "../../../test-utils/run-rule.js";
import { controlHasAssociatedLabel } from "./control-has-associated-label.js";

interface NativeButtonChildrenCase {
  name: string;
  code: string;
  expectedCount: number;
  options?: RunRuleOptions;
}

const commonOptions: RunRuleOptions = {
  filename: "independent-native-button.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react"],
      portedRuleMode: "curated",
    },
  },
};

const cases: ReadonlyArray<NativeButtonChildrenCase> = [
  {
    name: "expression-literal",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children={"Continue"} />);',
    expectedCount: 0,
  },
  {
    name: "quoted-literal",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="Continue" />);',
    expectedCount: 0,
  },
  {
    name: "empty-string",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="" />);',
    expectedCount: 1,
  },
  {
    name: "whitespace-string",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children={"   "} />);',
    expectedCount: 1,
  },
  {
    name: "boolean-child",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children={false} />);',
    expectedCount: 1,
  },
  {
    name: "null-child",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children={null} />);',
    expectedCount: 1,
  },
  {
    name: "last-duplicate-empty",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="Continue" children="" />);',
    expectedCount: 1,
  },
  {
    name: "last-duplicate-literal",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="" children="Continue" />);',
    expectedCount: 0,
  },
  {
    name: "nested-null-overrides",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="Continue">{null}</button>);',
    expectedCount: 1,
  },
  {
    name: "nested-text-overrides",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="">Continue</button>);',
    expectedCount: 0,
  },
  {
    name: "spread-after-children",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="Continue" {...props} />);',
    expectedCount: 0,
  },
  {
    name: "spread-before-children",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button {...props} children="Continue" />);',
    expectedCount: 0,
  },
  {
    name: "wrong-case-property",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button Children="Continue" />);',
    expectedCount: 1,
  },
  {
    name: "opaque-control",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<OpaqueControl children="Continue" />);',
    expectedCount: 1,
    options: {
      ...commonOptions,
      settings: {
        "react-doctor": {
          capabilities: ["react"],
          portedRuleMode: "curated",
          controlHasAssociatedLabel: {
            controlComponents: ["OpaqueControl"],
          },
        },
      },
    },
  },
  {
    name: "dynamic-child",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children={label} />);',
    expectedCount: 1,
  },
  {
    name: "symbol-only-policy",
    code: 'import React from "react"; const IndependentView = ({ props, label }) => (<button children="×" />);',
    expectedCount: 1,
  },
  {
    name: "static-template-child",
    code: 'import React from "react"; const IndependentView = () => (<button children={`Continue`} />);',
    expectedCount: 0,
  },
  {
    name: "unicode-letter-child",
    code: 'import React from "react"; const IndependentView = () => (<button children="続ける" />);',
    expectedCount: 0,
  },
  {
    name: "digit-child-string",
    code: 'import React from "react"; const IndependentView = () => (<button children="123" />);',
    expectedCount: 0,
  },
  {
    name: "numeric-child-not-admitted",
    code: 'import React from "react"; const IndependentView = () => (<button children={123} />);',
    expectedCount: 1,
  },
  {
    name: "boolean-true-child",
    code: 'import React from "react"; const IndependentView = () => (<button children={true} />);',
    expectedCount: 1,
  },
  {
    name: "bare-children-prop",
    code: 'import React from "react"; const IndependentView = () => (<button children />);',
    expectedCount: 1,
  },
  {
    name: "last-duplicate-null",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue" children={null} />);',
    expectedCount: 1,
  },
  {
    name: "last-duplicate-dynamic",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue" children={label} />);',
    expectedCount: 1,
  },
  {
    name: "last-duplicate-symbol",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue" children="×" />);',
    expectedCount: 1,
  },
  {
    name: "paired-empty-not-admitted",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue"></button>);',
    expectedCount: 1,
  },
  {
    name: "paired-comment-not-admitted",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue">{/* ignored */}</button>);',
    expectedCount: 1,
  },
  {
    name: "paired-whitespace-overrides",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue"> </button>);',
    expectedCount: 1,
  },
  {
    name: "inline-hidden-preserved",
    code: 'import React from "react"; const IndependentView = () => (<button style={{ display: "none" }} children="" />);',
    expectedCount: 0,
  },
  {
    name: "aria-hidden-preserved",
    code: 'import React from "react"; const IndependentView = () => (<button aria-hidden="true" children="" />);',
    expectedCount: 0,
  },
  {
    name: "hidden-ancestor-preserved",
    code: 'import React from "react"; const IndependentView = () => (<div aria-hidden="true"><button children="Continue" /></div>);',
    expectedCount: 0,
  },
  {
    name: "mapped-custom-button-not-admitted",
    code: 'import React from "react"; const IndependentView = () => (<CustomControl children="Continue" />);',
    expectedCount: 1,
    options: {
      ...commonOptions,
      settings: {
        ...commonOptions.settings,
        "jsx-a11y": {
          components: { CustomControl: "button" },
        },
      },
    },
  },
  {
    name: "native-button-mapped-away",
    code: 'import React from "react"; const IndependentView = () => (<button children="Continue" />);',
    expectedCount: 1,
    options: {
      ...commonOptions,
      settings: {
        ...commonOptions.settings,
        "jsx-a11y": {
          components: { button: "input" },
        },
      },
    },
  },
  {
    name: "member-component-not-admitted",
    code: 'import React from "react"; const IndependentView = () => (<UI.Button children="Continue" />);',
    expectedCount: 1,
    options: {
      ...commonOptions,
      settings: {
        "react-doctor": {
          capabilities: ["react"],
          portedRuleMode: "curated",
          controlHasAssociatedLabel: {
            controlComponents: ["UI.Button"],
          },
        },
      },
    },
  },
  {
    name: "select-children-not-control-name",
    code: 'import React from "react"; const IndependentView = () => (<select children="Continue" />);',
    expectedCount: 1,
  },
  {
    name: "input-children-not-admitted",
    code: 'import React from "react"; const IndependentView = () => (<input children="Continue" />);',
    expectedCount: 1,
  },
];

describe("native button literal children labels", () => {
  it.each(cases)("$name", ({ code, options, expectedCount }) => {
    const result = runRule(controlHasAssociatedLabel, code, options ?? commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
