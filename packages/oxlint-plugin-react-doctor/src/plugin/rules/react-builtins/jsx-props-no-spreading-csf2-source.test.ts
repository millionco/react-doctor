import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxPropsNoSpreading } from "./jsx-props-no-spreading.js";

const cases = [
  {
    name: "nominal",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    expected: 0,
    sourceSha256: "8c45aabb60b4a32dd79bb18c6f8904eb56e60b54bcc470df9052d1420a2db0f9",
  },
  {
    name: "inert-jsx-string",
    code: 'const label = "@jsx customElement"; void label;\nimport React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    expected: 0,
    sourceSha256: "2aea4d1653c07ec8a05e1342f8c03060dd43506ae785021dfdd5ace2cae2fb9e",
  },
  {
    name: "actual-jsx-pragma",
    code: '/** @jsx customElement */\nimport React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    expected: 1,
    sourceSha256: "9f881c9ebf4f2c0a3748c717b97dda8b3e21f458f28949813fe4836e5c98f73c",
  },
  {
    name: "merged-component-interface",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\ninterface ActionCard {}\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    expected: 0,
    sourceSha256: "bf80a74b72236e21cfa6e13ab622447cbc84cd10ed1e656382d89d85eb407c4e",
  },
  {
    name: "merged-template-interface",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\ninterface RenderExample {}\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    expected: 0,
    sourceSha256: "dbd53784b027e360d0159c27d5f4480549305b22298ab63410005cbfc16cc349",
  },
  {
    name: "merged-story-interface",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\ninterface Basic {}\nBasic.args = { label: "Preview" };\n',
    expected: 0,
    sourceSha256: "50e1da15ae9bef1fad17ed3ba11089d7a1dbb8c99584dbc7e4c5a8a1044c8313",
  },
];

const settings = {
  "react-doctor": {
    portedRuleMode: "curated",
    capabilities: ["react"],
    reactVersion: "18.3.1",
    reactMajorVersion: 18,
    jsxPropsNoSpreading: {
      html: "enforce",
      custom: "enforce",
      explicitSpread: "enforce",
      exceptions: [],
    },
  },
};

describe("closed CSF2 lexical source and merged bindings", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(jsxPropsNoSpreading, code, {
      filename: "/synthetic/csf-source.tsx",
      forceJsx: false,
      settings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
