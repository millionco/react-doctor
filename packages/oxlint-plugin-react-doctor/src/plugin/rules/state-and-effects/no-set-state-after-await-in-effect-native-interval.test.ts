import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface NativeIntervalEffectCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedCount: number;
}

const cases: ReadonlyArray<NativeIntervalEffectCase> = [
  {
    name: "native-interval-two-suspensions-clear-only",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/native-interval-two-suspensions-clear-only.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-guard-after-each-suspension",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    let cancelled = false;\n    const interval = setInterval(async () => { const first = await load(revision); if (cancelled) return; const second = await load(first); if (cancelled) return; setValue(second); }, 5000);\n    return () => { cancelled = true; clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/cleanup-guard-after-each-suspension.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "guard-before-second-await-only",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    let cancelled = false;\n    const interval = setInterval(async () => { const first = await load(revision); if (cancelled) return; const second = await load(first); setValue(second); }, 5000);\n    return () => { cancelled = true; clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/guard-before-second-await-only.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "mount-only-interval-preserves-old-scope",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, []);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/mount-only-interval-preserves-old-scope.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "stable-module-identity-dependency",
    code: 'import { useEffect, useState } from "react";\nconst stable = 1;\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [stable]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/stable-module-identity-dependency.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "shadowed-local-timer-registration",
    code: 'import { useEffect, useState } from "react";\nconst setInterval = (callback, delay) => 1;\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/shadowed-local-timer-registration.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "visible-native-timer-replacement",
    code: 'import { useEffect, useState } from "react";\nglobalThis.setInterval = replacement;\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/visible-native-timer-replacement.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "different-cleanup-handle",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(otherInterval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/different-cleanup-handle.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "handle-value-escape",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    inspect(interval);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/handle-value-escape.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "uncalled-async-helper-not-registered",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const unused = async () => { const result = await load(revision); setValue(result); };\n    const interval = setInterval(() => {}, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/uncalled-async-helper-not-registered.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "opaque-scheduler-callback",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = scheduleLater(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/opaque-scheduler-callback.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "sync-promise-callback-without-await",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(() => { load(revision).then(setValue); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/sync-promise-callback-without-await.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "legacy-direct-async-invocation",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    void (async () => { const result = await load(revision); setValue(result); })();\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/legacy-direct-async-invocation.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "native-registration-without-owned-cleanup",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/native-registration-without-owned-cleanup.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "optional-timer-registration",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval?.(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/optional-timer-registration.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "setter-only-before-suspension",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { setValue("started"); await load(revision); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/setter-only-before-suspension.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "never-executed-registration",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    if (false) {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n    }\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/never-executed-registration.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "callback-executable-default-parameter",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async (ignored = observe()) => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/callback-executable-default-parameter.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "conditional-cleanup-value",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return enabled ? () => clearInterval(interval) : undefined;\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/conditional-cleanup-value.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "ambient-timer-declaration-mask",
    code: 'import { useEffect, useState } from "react";\ndeclare function setInterval(callback: () => void, delay: number): number;\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/ambient-timer-declaration-mask.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "secondary-global-provider-escape",
    code: 'import { useEffect, useState } from "react";\nconst platform = globalThis; inspect(platform);\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/secondary-global-provider-escape.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "immediate-clear-before-any-tick",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    clearInterval(interval);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/immediate-clear-before-any-tick.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "post-await-guard-reset",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    let cancelled = false;\n    const interval = setInterval(async () => { const first = await load(revision); if (cancelled) return; const second = await load(first); if (cancelled) return; cancelled = false; setValue(second); }, 5000);\n    return () => { cancelled = true; clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/post-await-guard-reset.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-aborts-matching-signal",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const controller = new AbortController();\n    const interval = setInterval(async () => { const result = await fetch("/synthetic", {signal: controller.signal}); setValue(result.status); }, 5000);\n    return () => { controller.abort(); clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/cleanup-aborts-matching-signal.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "secondary-react-named-default-provider-transport",
    code: 'import { useEffect, useState } from "react";\nimport { default as NativeReact } from "react";\nobserve(NativeReact);\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename:
        "/synthetic/native-async-interval/secondary-react-named-default-provider-transport.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-secondary-react-provider-collision",
    code: 'import { useEffect, useState } from "react";\nimport * as NativeReact from "react";\nconst expose = () => { interface NativeReact {} observe(NativeReact); };\nexpose();\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/erased-secondary-react-provider-collision.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "native-function-carrier-unresolved-selector",
    code: 'import { useEffect, useState } from "react";\nconst selector = true ? "constructor" : "constructor";\nconst nativeCarrier = (() => {})[selector];\nnativeCarrier("globalThis.setInterval = replacement")();\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/native-function-carrier-unresolved-selector.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "native-constructor-carrier-destructuring",
    code: 'import { useEffect, useState } from "react";\nconst selector = true ? "constructor" : "constructor";\nconst { [selector]: nativeCarrier } = () => {};\nnativeCarrier("globalThis.setInterval = replacement")();\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/native-constructor-carrier-destructuring.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "selected-dispatcher-opaque-transport",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  observe(setValue);\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/selected-dispatcher-opaque-transport.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "timer-handle-cleanup-local-alias",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => { const handle = interval; clearInterval(handle); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/timer-handle-cleanup-local-alias.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "actual-react-namespace-hooks-positive",
    code: 'import * as NativeReact from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = NativeReact.useState("");\n  NativeReact.useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/actual-react-namespace-hooks-positive.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "type-only-effect-provider-declines",
    code: 'import { type useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename: "/synthetic/native-async-interval/type-only-effect-provider-declines.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "logical-function-carrier-unresolved-constructor-replaces-timer",
    code: 'import { useEffect, useState } from "react";\nconst selector = true ? "constructor" : "constructor";\nconst nativeCarrier = (false || (() => {}))[selector];\nnativeCarrier("setInterval = () => 0")();\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename:
        "/synthetic/native-async-interval/logical-function-carrier-unresolved-constructor-replaces-timer.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "logical-function-object-pattern-unresolved-constructor",
    code: 'import { useEffect, useState } from "react";\nconst selector = true ? "constructor" : "constructor";\nconst { [selector]: nativeCarrier } = (false || (() => {}));\nnativeCarrier("setInterval = () => 0")();\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename:
        "/synthetic/native-async-interval/logical-function-object-pattern-unresolved-constructor.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "static-numeric-index-after-await-remains-supported",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    const interval = setInterval(async () => { const first = await load(revision); const second = await load(first); setValue(second[0]); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    options: {
      filename:
        "/synthetic/native-async-interval/static-numeric-index-after-await-remains-supported.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          framework: "unknown",
          capabilities: ["react"],
        },
      },
    },
    expectedCount: 1,
  },
];

describe("native async interval effect", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noSetStateAfterAwaitInEffect, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
