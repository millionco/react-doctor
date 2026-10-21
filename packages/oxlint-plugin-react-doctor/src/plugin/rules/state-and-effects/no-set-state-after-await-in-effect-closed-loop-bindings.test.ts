import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "nominal",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/00-nominal.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-Promise-interface",
    code: "import { useEffect, useState } from 'react';\ninterface Promise { unused: true }\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/01-erased-Promise-interface.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-setTimeout-type",
    code: "import { useEffect, useState } from 'react';\ntype setTimeout = { unused: true };\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/02-erased-setTimeout-type.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "merged-pause-interface",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\ninterface pause { unused: true }\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/03-merged-pause-interface.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "unrelated-outer-cancelled-interface",
    code: "import { useEffect, useState } from 'react';\ninterface cancelled { unused: true }\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/04-unrelated-outer-cancelled-interface.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "unrelated-interface-control",
    code: "import { useEffect, useState } from 'react';\ninterface Unrelated { unused: true }\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/05-unrelated-interface-control.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "unsafe-erased-setter",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n interface setPhase { unused: true }\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); setPhase('calling'); await pause(10); setPhase('rendering'); await pause(10); setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/06-unsafe-erased-setter.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "unsafe-erased-hook",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n interface useState { unused: true }\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); setPhase('calling'); await pause(10); setPhase('rendering'); await pause(10); setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/07-unsafe-erased-hook.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "runtime-Promise-shadow",
    code: "import { useEffect, useState } from 'react';\nconst Promise = class { constructor(_executor: unknown) {} };\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/08-runtime-Promise-shadow.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "unsafe-baseline",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); setPhase('calling'); await pause(10); setPhase('rendering'); await pause(10); setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/upper-closed-native-loop/09-unsafe-baseline.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "nominal",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/00-nominal.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "selected-promise-prototype-write",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nPromise.prototype.then = () => {};\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/01-selected-promise-prototype-write.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "selected-timeout-write",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nsetTimeout = () => 0;\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/02-selected-timeout-write.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "selected-promise-opaque-transport",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\ndeclare const expose: (value: unknown) => void; expose(Promise);\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/03-selected-promise-opaque-transport.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "selected-timeout-readonly-observation",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nvoid setTimeout;\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/04-selected-timeout-readonly-observation.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
  {
    name: "foreign-provider-write",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nconst clock = { tick: 0 }; clock.tick = 1;\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/05-foreign-provider-write.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "foreign-provider-readonly",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nconst clock = { tick: 0 }; void clock.tick;\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    filename: "/synthetic/2118-provider/06-foreign-provider-readonly.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "closed-erased-promise-generator",
    code: 'import { useEffect as useFuzzSleepEffect, useState as useFuzzSleepState } from "react";\ninterface Promise {}\nconst fuzzNativeSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));\nexport const FuzzClosedNativeSleepLoop = ({ revision }: { revision: number }) => {\n  const [phase, setPhase] = useFuzzSleepState("idle");\n  useFuzzSleepEffect(() => {\n    let cancelled = false;\n    const run = async () => {\n      while (!cancelled) {\n        await fuzzNativeSleep(1);\n        if (cancelled) return;\n        setPhase("ready");\n      }\n    };\n    run();\n    return () => { cancelled = true; };\n  }, [revision]);\n  return <output>{phase}</output>;\n};\n',
    filename: "/synthetic/2118-generator/00-closed-erased-promise-generator.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 0,
  },
  {
    name: "unguarded-erased-promise-generator-control",
    code: 'import { useEffect as useFuzzSleepEffect, useState as useFuzzSleepState } from "react";\ninterface Promise {}\nconst fuzzNativeSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));\nexport const FuzzClosedNativeSleepLoop = ({ revision }: { revision: number }) => {\n  const [phase, setPhase] = useFuzzSleepState("idle");\n  useFuzzSleepEffect(() => {\n    let cancelled = false;\n    const run = async () => {\n      while (!cancelled) {\n        await fuzzNativeSleep(1);\n        setPhase("ready");\n      }\n    };\n    run();\n    return () => { cancelled = true; };\n  }, [revision]);\n  return <output>{phase}</output>;\n};\n',
    filename: "/synthetic/2118-generator/01-unguarded-erased-promise-generator-control.tsx",
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: ["react"],
      },
    },
    expectedCount: 1,
  },
];

describe("closed native sleep loop runtime bindings", () => {
  for (const fixture of cases) {
    it(fixture.name, () => {
      const result = runRule(noSetStateAfterAwaitInEffect, fixture.code, {
        filename: fixture.filename,
        settings: fixture.settings,
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.expectedCount);
    });
  }
});
