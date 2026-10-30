import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const nominalCode =
  'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n';
const defaultReactCode = nominalCode.replace(
  'import * as React from "react";',
  'import React from "react";',
);
const cases = [
  { name: "nominal", code: nominalCode, expectedCount: 0 },
  {
    name: "inert-state-interface",
    code: "interface needsSetup {}\n" + nominalCode,
    expectedCount: 0,
  },
  {
    name: "inert-setter-type",
    code: "type setNeedsSetup = unknown;\n" + nominalCode,
    expectedCount: 0,
  },
  { name: "merged-react-interface", code: "interface React {}\n" + nominalCode, expectedCount: 0 },
  {
    name: "inner-state-interface",
    code: nominalCode.replace(
      "    const element = host.current;",
      "    interface needsSetup {}\n    const element = host.current;",
    ),
    expectedCount: 0,
  },
  {
    name: "outer-type-only-state-import",
    code: 'import type { Input as needsSetup } from "types";\n' + nominalCode,
    expectedCount: 0,
  },
  { name: "default-react-nominal", code: defaultReactCode, expectedCount: 0 },
  {
    name: "default-react-getter-mutation",
    code: 'React.__defineGetter__("useState",()=>replacement);\n' + defaultReactCode,
    expectedCount: 1,
  },
  {
    name: "default-react-setter-mutation",
    code: 'React.__defineSetter__("useState",replacement);\n' + defaultReactCode,
    expectedCount: 1,
  },
  {
    name: "default-react-readonly-descriptor-read",
    code: 'React.__lookupGetter__("useState");\n' + defaultReactCode,
    expectedCount: 0,
  },
  {
    name: "default-react-readonly-module-call",
    code: "React.memo(()=>null);\n" + defaultReactCode,
    expectedCount: 0,
  },
];

describe("private initialization latch runtime bindings and provider integrity", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noAdjustStateOnPropChange, code, {
      filename: "/synthetic/private-latch-review/use-layout-setup.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
