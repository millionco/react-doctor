import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

interface PrivateInitializationLatchCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedCount: number;
}

const cases: ReadonlyArray<PrivateInitializationLatchCase> = [
  {
    name: "closed-private-true-to-false-setup",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-00.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "named-value-hooks",
    code: 'import * as React from "react";\nimport { useState as useFlag, useEffect as useLayoutEffect } from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = useFlag(true);\n  useLayoutEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-01.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "nested-ordinary-ref-presence-guard",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element && revision >= 0) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-02.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "returned-latch-value",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n  return needsSetup;\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-03.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "returned-latch-setter",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n  return setNeedsSetup;\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-04.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "rendered-latch",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const LayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n  return <output>{needsSetup ? "pending" : "ready"}</output>;\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-05.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "rearmed-from-another-effect",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n  React.useEffect(() => { setNeedsSetup(true); }, [revision]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-06.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 2,
  },
  {
    name: "setter-passed-to-opaque-observer",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  observe(setNeedsSetup);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-07.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "latch-aliased-and-consumed",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  const copiedFlag = needsSetup;\n  observe(copiedFlag);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-08.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "initializer-from-prop",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(revision > 0);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-09.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "setter-value-from-prop",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(revision > 0);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-10.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "guard-writes-visible-prop-copy",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  const [label, setLabel] = React.useState("");\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n        setLabel(String(revision));\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-11.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "direct-eval-can-expose-latch",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  eval("observe(needsSetup); setNeedsSetup(true)");\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-12.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "ambient-erased-name-can-mask-selected-use",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  const expose = () => { interface needsSetup {} observe(needsSetup); };\n  expose();\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-13.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "mutated-react-hook-provider",
    code: 'import * as React from "react";\nReact.useState = replacement;\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-14.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "guard-is-not-selected-state",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (revision > 0) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-15.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "secondary-named-default-react-provider-escape",
    code: 'import * as React from "react";\nimport { default as SecondaryReact } from "react";\nobserve(SecondaryReact);\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-16.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "erased-secondary-provider-exposure",
    code: 'import * as React from "react";\nimport { default as SecondaryReact } from "react";\nconst expose = () => { interface SecondaryReact {} observe(SecondaryReact); };\nexpose();\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-17.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "ambient-declaration-pre-prune-boundary",
    code: 'import * as React from "react";\ndeclare const hiddenRuntime: unknown;\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-18.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "effect-default-parameter-side-effect",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect((unused = observe()) => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-19.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "owner-returns-unrelated-object",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n  return { host };\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-20.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "opaque-call-in-initialization-branch",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        inspect();\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-21.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "compound-selected-state-guard",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup && revision > 0) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-22.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "setter-through-local-binding-alias",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  const finishSetup = setNeedsSetup;\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        finishSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-23.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "state-hook-extra-argument",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true, observe);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-24.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "state-tuple-extra-binding",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup, extra] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-25.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "mutable-state-tuple",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  let [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-26.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "callback-transport-in-initialization-branch",
    code: 'import * as React from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        inspect(() => revision);\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-27.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "type-only-react-hook-source",
    code: 'import * as React from "react";\nimport { type useState as useFlag } from "react";\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = useFlag(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-28.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "safe-unrelated-erased-data-interface",
    code: 'import * as React from "react";\ninterface UnrelatedData { caption: string }\ninterface LayoutInputs { revision: number; host: React.MutableRefObject<HTMLElement | null> }\nexport const useLayoutSetup = ({ revision, host }: LayoutInputs) => {\n  const [needsSetup, setNeedsSetup] = React.useState(true);\n  React.useEffect(() => {\n    const element = host.current;\n    if (element) {\n      if (needsSetup) {\n        element.style.minHeight = "12px";\n        setNeedsSetup(false);\n      }\n      element.style.height = `${revision}px`;\n    }\n  }, [revision, host.current]);\n};\n',
    options: {
      filename: "/synthetic/private-dom-latch/case-29.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      },
    },
    expectedCount: 0,
  },
];

describe("private initialization latch", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noAdjustStateOnPropChange, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
