import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const reviewCases = [
  {
    name: "baseline-owned-compound",
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
    name: "merged-readonly-tail",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      interface payload {}\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "inner-erased-cancellation-name",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      interface cancelled {}\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "merged-tail-type-alias",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      type payload = unknown;\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "unguarded-control",
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
    name: "hidden-reset-control",
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
  {
    name: "tail-write-control",
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
    name: "inner-real-cancellation-shadow",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      let cancelled = false;\n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "inert-eval-object-key",
    code: 'const metadata = { eval: "label" }; void metadata;\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "inert-eval-member-key",
    code: 'const metadata = { label: "ok" }; metadata.eval;\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "actual-direct-eval-reference",
    code: 'import { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      eval("cancelled = false");\n if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "actual-eval-alias-reference",
    code: 'const evaluate = eval; void evaluate;\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "proven-global-eval-member",
    code: 'void globalThis.eval;\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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
    name: "proven-global-eval-carrier-alias",
    code: 'const rootCarrier = globalThis; void rootCarrier.eval;\nimport { useEffect, useState } from "react";\ninterface ExampleProps { enabled: boolean }\nexport const Example = ({ enabled }: ExampleProps) => {\n  const [value, setValue] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    const load = async () => {\n      const payload = await Promise.resolve({ count: 1 });\n      \n      if (!cancelled && payload && typeof payload === "object") { setValue(payload); }\n      \n    };\n    void load();\n    return () => { cancelled = true; };\n  }, [enabled]);\n  return <output>{String(value)}</output>;\n};\n',
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

describe("owned compound prefix runtime binding review", () => {
  for (const source of reviewCases) {
    it(source.name, () => {
      const result = runRule(noSetStateAfterAwaitInEffect, source.code, source.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(source.expected);
    });
  }
});
