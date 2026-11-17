import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

const typedReceiverBindingCases = [
  {
    name: "nominal-adjacent",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    expected: 0,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
  },
  {
    name: "interface-before",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\ninterface Preview { readonly tag: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    expected: 0,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
  },
  {
    name: "interface-after-name",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\ninterface Preview { readonly tag: string }\n",
    expected: 0,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
  },
  {
    name: "type-alias-after-name",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\ntype Preview = { readonly tag: string };\n",
    expected: 0,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
  },
  {
    name: "type-query-only-after-name",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\ntype PreviewShape = typeof Preview;\n",
    expected: 0,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
  },
  {
    name: "runtime-value-alias-negative",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nexport const Alias = Preview;\n",
    expected: 1,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
  },
];

describe("display-name typed receiver runtime bindings", () => {
  for (const control of typedReceiverBindingCases) {
    it(control.name, () => {
      const result = runRule(displayName, control.code, {
        settings: control.settings,
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expected);
    });
  }
});
