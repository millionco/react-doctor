import { describe, expect, it } from "vite-plus/test";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface CancellationPrefixCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expected: number;
}

const CASES: CancellationPrefixCase[] = [
  {
    name: "unguarded-after-await",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      setValue(payload);\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "existing-direct-atomic-prefix",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "compound-owned-prefix-typeof",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "compound-prefix-strict-typeof-comparison",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload !== null && typeof payload !== "undefined") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "live-flag-opposite-cleanup",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let live = true;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (live && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { live = false; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "parenthesized-left-associated-prefix",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (((!cancelled && payload) && typeof payload === "object")) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "erased-annotation-and-record-assertion",
    code: 'interface ResultShape { count: number }\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      const typedPayload: unknown = payload;\n      if (!cancelled && typedPayload && typeof typedPayload === "object") { const record = typedPayload as Record<string, unknown>; setValue(record.count); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "member-getter-tail-not-admitted",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && payload.ready) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "call-tail-not-admitted",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      const accepts = () => true;\n      if (!cancelled && payload && accepts()) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "suspension-on-outer-right",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && await Promise.resolve(true)) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "flag-reset-on-outer-right",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && (cancelled = false) === false) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "loose-comparison-tail-not-admitted",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && payload == 1) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "post-guard-await-before-setter",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { await Promise.resolve(); setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "missing-owned-cleanup",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { void 0; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "additional-flag-writer",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      cancelled = false;\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "runtime-enum-write-not-admitted",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      enum LocalState { Ready = (cancelled = false, 1) }\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "eval-channel-not-admitted",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      eval("void 0");\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "tail-binding-write-not-admitted",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      let available = payload; available = null;\n      if (!cancelled && available && typeof available === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "readonly-component-parameter-tail",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof enabled === "boolean") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "unresolved-typeof-tail",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof missingValue === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nested-tail-binding-writer",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      let payload = await Promise.resolve({ count: 1 });\n      const changePayload = () => { payload = null; };\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "outer-right-suspension-after-typeof",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object" && await Promise.resolve(true)) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "runtime-namespace-outside-owner",
    code: 'namespace RuntimeState { export let ready = true; }\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "eval-read-outside-owner",
    code: 'const otherRead = () => eval;\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "unused-erased-eval-interface",
    code: 'interface eval { ready: boolean }\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "transparent-assertion-in-typeof-tail",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof (payload as unknown) === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "regex-literal-tail-not-primitive",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object" && /ready/) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "bigint-literal-tail-not-primitive",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object" && 1n) { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "loop-write-tail-binding",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      let payload = await Promise.resolve({ count: 1 });\n      for (payload of []) { void payload; }\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "pattern-write-tail-binding",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      let payload = await Promise.resolve({ count: 1 });\n      [payload] = [];\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ambient-module-tail-binding-abstains",
    code: 'import { useEffect, useState } from "react";\ndeclare const suppliedPayload: unknown;\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && suppliedPayload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ambient-phantom-cancellation-shadow-abstains",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const reset = () => {\n        declare let cancelled: boolean;\n        cancelled = false;\n      };\n      const payload = await Promise.resolve({ count: 1 });\n      reset();\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "erased-interface-does-not-mask-cancellation-reset",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const reset = () => {\n        interface cancelled {}\n        cancelled = false;\n      };\n      const payload = await Promise.resolve({ count: 1 });\n      reset();\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
    options: {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
];

describe("cleanup-owned conjunction prefixes", () => {
  it.each(CASES)("$name", ({ code, options, expected }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
