import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "complete-four-stage-cycle",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/00-complete-four-stage-cycle.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "entry-after-each-backedge",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('tick'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/01-entry-after-each-backedge.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "fresh-guard-after-two-awaits",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); await pause(10); if (cancelled) return; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/02-fresh-guard-after-two-awaits.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "renamed-binding-identity",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setStage] = useState('idle');\n useEffect(() => {\n  let didStop = false;\n  \n  const advanceCycle = async () => {\n   while (!didStop) {\n    setStage('idle'); await pause(10); if (didStop) return; setStage('calling'); await pause(10); if (didStop) return; setStage('rendering'); await pause(10); if (didStop) return; setStage('resolving'); await pause(10);\n   }\n   \n  };\n  advanceCycle();\n  \n  return () => { didStop = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/03-renamed-binding-identity.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "missing-post-await-guard",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/04-missing-post-await-guard.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "stale-pre-await-guard",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    if (cancelled) return; await pause(10); setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/05-stale-pre-await-guard.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "second-await-invalidates-guard",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); if (cancelled) return; await pause(10); setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/06-second-await-invalidates-guard.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "missing-backedge-condition",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (true) {\n    setPhase('tick'); await pause(10); if (cancelled) return; setPhase('done'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/07-missing-backedge-condition.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "setter-after-loop",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); if (cancelled) return; setPhase('tick');\n   }\n   setPhase('after');\n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/08-setter-after-loop.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "conditional-cleanup",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { if (enabled) cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/09-conditional-cleanup.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-writes-other-binding",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  let otherCancelled = false;\n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { otherCancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/10-cleanup-writes-other-binding.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-resets-false",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = false; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/11-cleanup-resets-false.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-suspends",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return async () => { await pause(10); cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/12-cleanup-suspends.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-param-shadows-flag",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return (cancelled: boolean) => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/13-cleanup-param-shadows-flag.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "post-await-flag-reset",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); cancelled = false; if (cancelled) return; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/14-post-await-flag-reset.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "captured-helper-reset",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const reset = () => { cancelled = false; };\n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); reset(); if (cancelled) return; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/15-captured-helper-reset.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "escaped-flag-reader",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  load(() => cancelled);\n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/16-escaped-flag-reader.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "setter-transported",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await load(setPhase); if (cancelled) return; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/17-setter-transported.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "run-transported",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  load(run);\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/18-run-transported.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "separate-unsafe-async-function",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  const unsafe = async () => { await pause(10); setPhase('unsafe'); }; unsafe();\n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/19-separate-unsafe-async-function.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "finally-dispatch-after-return",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    try { await pause(10); if (cancelled) return; } finally { setPhase('finally'); }\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/20-finally-dispatch-after-return.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "do-while",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   do {\n    setPhase('tick'); await pause(10);\n   } while (!cancelled);\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/21-do-while.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "compound-loop-test",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled && enabled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/22-compound-loop-test.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "break-exit-with-trailing-setter",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); if (enabled) break; if (cancelled) return; setPhase('tick');\n   }\n   setPhase('after');\n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/23-break-exit-with-trailing-setter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "continue-bypasses-guard",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); if (enabled) continue; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/24-continue-bypasses-guard.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "functional-setter-value",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); if (cancelled) return; setPhase(previous => previous + '!');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/25-functional-setter-value.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "multiple-flag-declarators",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false, sibling = 0;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/26-multiple-flag-declarators.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "stale-alias-snapshot",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    const stopped = cancelled; await pause(10); if (stopped) return; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/27-stale-alias-snapshot.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "nested-dispatch-closure",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const publish = () => setPhase('tick');\n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); if (cancelled) return; publish();\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/28-nested-dispatch-closure.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "eval-shaped-flag-write",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    await pause(10); eval('cancelled = false'); if (cancelled) return; setPhase('tick');\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/29-eval-shaped-flag-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "nested-loop",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    while (!cancelled) { await pause(10); if (cancelled) return; setPhase('tick'); }\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/30-nested-loop.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "extra-direct-early-return",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('tick'); if (cancelled) return; await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/31-extra-direct-early-return.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "immutable-effect-local-literal-delay",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/32-immutable-effect-local-literal-delay.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "mutable-delay-rebinding",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  let PHASE_MS = 2000;\n  \n  const run = async () => {\n   PHASE_MS = 25;\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/33-mutable-delay-rebinding.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "unknown-delay-initializer",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = revision;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/34-unknown-delay-initializer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "one-hop-delay-alias-not-admitted",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  const WAIT_MS = PHASE_MS;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(WAIT_MS); if (cancelled) return; setPhase('calling'); await pause(WAIT_MS); if (cancelled) return; setPhase('rendering'); await pause(WAIT_MS); if (cancelled) return; setPhase('resolving'); await pause(WAIT_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/35-one-hop-delay-alias-not-admitted.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "ambient-typed-delay-has-no-runtime-literal-certificate",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\ndeclare const PHASE_MS: number;\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename:
        "/synthetic/guarded-async-while/36-ambient-typed-delay-has-no-runtime-literal-certificate.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "erased-delay-expression-wrapper-declines",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS as number); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS as number); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS as number); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS as number);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/37-erased-delay-expression-wrapper-declines.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "shadowed-same-spelling-delay",
    code: "import { useEffect, useState } from 'react';\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  \n  const run = async () => {\n   const PHASE_MS = revision;\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/38-shadowed-same-spelling-delay.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "module-Promise-runtime-shadow",
    code: "import { useEffect, useState } from 'react';\nconst Promise = class { constructor(executor: unknown) {} };\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/39-module-Promise-runtime-shadow.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "module-setTimeout-runtime-shadow",
    code: "import { useEffect, useState } from 'react';\nconst setTimeout = (callback: () => void, delayMs: number) => callback();\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/40-module-setTimeout-runtime-shadow.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "module-helper-captured-writer-callback",
    code: "import { useEffect, useState } from 'react';\nlet externalWriter: (value: string) => void = () => {};\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(() => { externalWriter('calling'); resolve(); }, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  externalWriter = setPhase;\n  let cancelled = false;\n  const PHASE_MS = 2000;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(PHASE_MS); if (cancelled) return; setPhase('calling'); await pause(PHASE_MS); if (cancelled) return; setPhase('rendering'); await pause(PHASE_MS); if (cancelled) return; setPhase('resolving'); await pause(PHASE_MS);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/synthetic/guarded-async-while/41-module-helper-captured-writer-callback.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "bare-constructor-object-pattern-reflection",
    code: "import { useEffect, useState } from 'react';\nconst { constructor: Build } = (() => {}); Build(\"return 0\")();\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/src/closed-native-loop-reflection-42.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "computed-static-constructor-object-pattern-reflection",
    code: "import { useEffect, useState } from 'react';\nconst { [\"constructor\"]: Build } = (() => {}); Build(\"return 0\")();\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/src/closed-native-loop-reflection-43.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "unresolved-computed-object-pattern-key",
    code: "import { useEffect, useState } from 'react';\nconst reflectionKey = \"constructor\"; const { [reflectionKey]: Build } = (() => {}); Build(\"return 0\")();\nconst pause = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));\nexport const LoopPanel = ({ revision, enabled, load }: { revision: number; enabled: boolean; load: (...values: unknown[]) => Promise<unknown> }) => {\n const [phase, setPhase] = useState('idle');\n useEffect(() => {\n  let cancelled = false;\n  \n  const run = async () => {\n   while (!cancelled) {\n    setPhase('idle'); await pause(10); if (cancelled) return; setPhase('calling'); await pause(10); if (cancelled) return; setPhase('rendering'); await pause(10); if (cancelled) return; setPhase('resolving'); await pause(10);\n   }\n   \n  };\n  run();\n  \n  return () => { cancelled = true; };\n }, [revision, enabled, load]);\n return <div>{phase}</div>;\n};\n",
    options: {
      filename: "/src/closed-native-loop-reflection-44.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
];

describe("no-set-state-after-await-in-effect closed native sleep loop", () => {
  for (const fixture of cases) {
    it(fixture.name, () => {
      const result = runRule(noSetStateAfterAwaitInEffect, fixture.code, fixture.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.expectedCount);
    });
  }
});
