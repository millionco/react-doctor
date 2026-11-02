import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleResult } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface MotionProviderBoundaryCase {
  name: string;
  code: string;
  expected: RunRuleResult;
}

const cases: MotionProviderBoundaryCase[] = [
  {
    name: "nominal",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "effect-interface",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { interface EffectMarker {} return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "effect-type-alias",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { type EffectMarker = string; return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "erased-use-scroll",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  interface useScroll {}\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "erased-scroll-value",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  interface scrollY {}\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unreturned",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 5,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "erased-effect-unreturned",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  interface useEffect {}\n  useEffect(() => { scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 6,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "runtime-use-scroll-companion",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  interface useScroll {}\n  const useScroll = props.readScroll;\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 7,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "static-provider-prototype-write",
    code: 'import { useScroll, useMotionValue } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const companion = useMotionValue(0);\n  companion.get();\n  companion.__proto__.on = (event, listener) => { document.addEventListener("click", listener); return () => {}; };\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 8,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "dynamic-provider-prototype-write",
    code: 'import { useScroll, useMotionValue } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const companion = useMotionValue(0);\n  companion.get();\n  companion[props.prototypeKey][props.subscriptionKey] = (event, listener) => { document.addEventListener("click", listener); return () => {}; };\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 8,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "unrelated-dynamic-record-write",
    code: 'import { useScroll, useMotionValue } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const companion = useMotionValue(0);\n  companion.get();\n  const ordinaryRecord = { details: {} };\n  ordinaryRecord[props.recordKey][props.fieldKey] = () => {};\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "aliased-dynamic-provider-prototype-write",
    code: 'import { useScroll, useMotionValue } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const companion = useMotionValue(0);\n  companion.get();\n  const companionAlias = companion;\n  companionAlias[props.prototypeKey][props.subscriptionKey] = (event, listener) => { document.addEventListener("click", listener); return () => {}; };\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 9,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "finite-key-provider-prototype-write",
    code: 'import { useScroll, useMotionValue } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const companion = useMotionValue(0);\n  companion.get();\n  const prototypeKey = "__proto__";\n  const subscriptionKey = "on";\n  companion[prototypeKey][subscriptionKey] = (event, listener) => { document.addEventListener("click", listener); return () => {}; };\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 10,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
];

describe("returned Motion scroll disposer provider boundaries", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        runRule(effectNeedsCleanup, testCase.code, {
          filename: "synthetic-motion-provider-boundary.tsx",
          includeLocations: true,
          settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        }),
      ).toEqual(testCase.expected);
    });
  }
});
