import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions, RunRuleResult } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface MotionScrollDisposerCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expected: RunRuleResult;
}

const motionScrollDisposerCases: MotionScrollDisposerCase[] = [
  {
    name: "direct-returned-scroll-change-disposer",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "renamed-value-import-and-destructured-binding",
    code: 'import { useScroll as readScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY: vertical } = readScroll();\n  useEffect(() => { return vertical.on("change", (current) => { void current; }); }, [vertical]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "original-shaped-readonly-methods-and-deferred-handler-returns",
    code: 'import { useScroll, useMotionValue } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY, scrollYProgress } = useScroll(); const destination = useMotionValue(0);\n  useEffect(() => { return scrollY.on("change", (current) => { if (current < 0) return; const previous = scrollY.getPrevious() ?? 0; if (scrollYProgress.get() > 0.8) return; destination.set(current - previous); }); }, [scrollY, scrollYProgress, destination]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "concise-effect-directly-returned-disposer",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => scrollY.on("change", (current) => { void current; }), [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "bare-registration-with-no-return",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { scrollY.on("change", () => {}); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "stored-disposer-not-direct-return",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { const dispose = scrollY.on("change", () => {}); return dispose; }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "conditional-exit-after-registration",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { const dispose = scrollY.on("change", () => {}); if (props.skip) return; return dispose; }, [scrollY, props.skip]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "return-wrong-motionvalue-disposer",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll(); const other = props.value;\n  useEffect(() => { scrollY.on("change", () => {}); return other.on("change", () => {}); }, [scrollY, other]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "handler-returns-cleanup-but-effect-does-not",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { scrollY.on("change", () => () => {}); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "async-effect-promise-is-not-react-cleanup",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(async () => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "prop-receiver-lookalike-on",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const scrollY = props.value;\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "same-hook-name-from-unknown-module",
    code: 'import { useScroll } from "unverified-motion";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "local-hook-return-lookalike",
    code: 'import { useEffect } from "react";\nconst useScroll = () => ({ scrollY: { on: () => ({}) } });\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "whole-type-only-motion-hook-runtime-use",
    code: 'import type { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "inline-type-only-motion-hook-runtime-use",
    code: 'import { type useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "shadowed-motion-hook",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (useScroll) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "mutable-destructured-result-binding",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  let { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "selected-value-reassignment",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  let { scrollY } = useScroll();\n  scrollY = props.value; useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 25,
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
    name: "direct-selected-on-replacement",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  scrollY.on = props.attach; useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 29,
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
    name: "selected-on-descriptor-write",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  Object.defineProperty(scrollY, "on", { value: props.attach }); useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 65,
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
    name: "selected-value-opaque-call-escape",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  props.change(scrollY); useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 25,
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
    name: "selected-value-escape-in-return-object",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = () => { const { scrollY } = useScroll(); useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]); return { scrollY }; };\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 64,
          line: 3,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "selected-value-const-alias",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const alias = scrollY; useEffect(() => { return alias.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 25,
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
    name: "result-container-transport-instead-of-direct-destructure",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const result = useScroll(); const scrollY = result.scrollY;\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "sibling-motion-result-opaque-transport",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY, scrollYProgress } = useScroll();\n  props.change(scrollYProgress); useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 33,
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
    name: "namespace-motion-import",
    code: 'import * as Motion from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = Motion.useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "hook-options-outside-zeroarg-route",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll({ container: props.target });\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "different-motion-event-outside-change-only-route",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("animationStart", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "computed-method-outside-direct-member-route",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY["on"]("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "extracted-method-loses-receiver-and-escapes",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const attach = scrollY.on; useEffect(() => attach("change", () => {}), [attach]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "spread-extra-registration-arguments",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }, ...props.extra); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "dynamic-loader-known-mutation-capability",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nconst namespace = await import("node:vm"); namespace.runInThisContext("globalThis.__modifiedMotion = true");\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "reflected-function-constructor-capability",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nconst { constructor: Build } = (() => {}); Build("globalThis.__modifiedMotion = true")();\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "wrong-react-effect-provider",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "unverified-react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "finite-computed-prototype-provider-capability",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  const key = "con" + "structor"; const prototype = scrollY[key].prototype; prototype.on = props.attach; useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 105,
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
    name: "effect-extra-opaque-setup-before-registration",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { props.setup(); return scrollY.on("change", () => {}); }, [scrollY, props.setup]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "effect-extra-native-registration-remains-unreleased",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = (props) => {\n  const { scrollY } = useScroll();\n  useEffect(() => { document.addEventListener("click", () => {}); return scrollY.on("change", () => {}); }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 5,
          message:
            "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "declaration-after-effect-tdz",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = () => { useEffect(() => { return scrollY.on("change", (current) => { void current; }); }, [scrollY]); const { scrollY } = useScroll(); return null; };\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 31,
          line: 3,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "named-effect-default-parameter-self-transport",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nlet replay = () => {};\nexport const Example = () => {\n  const { scrollY } = useScroll();\n  useEffect(function register(ignored = (replay = register)) {\n    return scrollY.on("change", () => {});\n  }, [scrollY]);\n  return <button onClick={() => { replay(); }}>Subscribe again</button>;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
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
    name: "const-arrow-effect-callback-replayed-from-react-event",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nexport const Example = () => {\n  const { scrollY } = useScroll();\n  const register = () => scrollY.on("change", () => {});\n  useEffect(register, [scrollY]);\n  return <button onClick={() => { register(); }}>Subscribe again</button>;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "known-motion-collector-state-replaces-selected-subscription-manager",
    code: 'import { useScroll } from "motion/react";\nimport { useEffect } from "react";\nimport { collectMotionValues } from "motion-dom";\ncollectMotionValues.current = {\n  push: (value) => {\n    value.events = {\n      change: {\n        add: (listener) => {\n          document.addEventListener("click", listener);\n          return () => {};\n        },\n        notify: () => {},\n        getSize: () => 1,\n      },\n    };\n  },\n};\nexport const Example = () => {\n  const { scrollY } = useScroll();\n  scrollY.get();\n  useEffect(() => {\n    return scrollY.on("change", () => {});\n  }, [scrollY]);\n  return null;\n};\n',
    options: {
      filename: "synthetic-motion-scroll-disposer.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: {
      diagnostics: [
        {
          column: 2,
          line: 21,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
];

describe("effect-needs-cleanup returned Motion scroll disposer", () => {
  for (const testCase of motionScrollDisposerCases) {
    it(testCase.name, () => {
      expect(runRule(effectNeedsCleanup, testCase.code, testCase.options)).toEqual(
        testCase.expected,
      );
    });
  }
});
