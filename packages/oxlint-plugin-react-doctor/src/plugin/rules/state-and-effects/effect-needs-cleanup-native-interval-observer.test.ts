import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const cases = [
  {
    name: "guarded-native-joint-owner",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-00.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "early-no-allocation-return",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver === 'undefined') return;\n    {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-01.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "unconditional-native-joint-owner",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-02.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "missing-observer-release",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-03.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "missing-scheduler-cancellation",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-04.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "different-observer-release",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        new ResizeObserver(() => {}).disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-05.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "different-timer-cancellation",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(0);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-06.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "conditional-observer-release",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        if (enabled) observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-07.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "conditional-scheduler-cancellation",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        if (enabled) clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-08.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "observer-value-escape",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      consume(observer);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-09.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "observer-method-replacement",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      observer.observe = () => {};\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-10.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "mutable-observer-storage",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      let observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-11.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "two-intervals-overwrite-last-handle",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      let interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      interval = setInterval(() => observer.observe(target), 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-12.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "loop-overwrites-selected-timer",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      let interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      for (const item of [1, 2]) {\n        interval = setInterval(() => observer.observe(target), item);\n      }\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-13.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "promise-channel-after-tick",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          Promise.resolve().then(() => observer.observe(target));\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-14.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "async-native-callback",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(async () => {\n        if (target) {\n          clearInterval(interval);\n          await Promise.resolve();\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-15.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "nested-rescheduling-channel",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          setInterval(() => observer.observe(target), 10);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-16.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "post-allocation-early-return",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      if (enabled) return;\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-17.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "cleanup-creates-new-registration-channel",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n        setTimeout(() => observer.observe(target), 0);\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-18.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "same-spelling-observer-provider",
    code: "import { useEffect } from 'react';\nconst ResizeObserver = class { observe(_target: Element) {} disconnect() {} };\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-19.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "same-spelling-scheduler-provider",
    code: "import { useEffect } from 'react';\nconst setInterval = (_callback: () => void, _delay: number) => 1;\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/panel-20.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "observer-delivery-parameter-escape",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver((_entries, delivered) => { consume(delivered); });\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/observer-delivery-parameter-escape.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "dynamic-local-observer-write",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      eval('observer.disconnect = () => {}');\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/dynamic-local-observer-write.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "timer-callback-additional-channel",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          queueMicrotask(() => observer.observe(target));\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/timer-callback-additional-channel.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "repeated-allocation-block",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    for (const item of [1, 2]) {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/repeated-allocation-block.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "known-vm-provider-write",
    code: "import { useEffect } from 'react';\nimport * as evaluator from 'node:vm';\nevaluator.runInThisContext(\"globalThis.ResizeObserver.prototype.disconnect = () => {}\");\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/known-vm-provider-write.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "erased-known-global-channel",
    code: "import { useEffect } from 'react';\ninterface process {}\nprocess.getBuiltinModule('vm').runInThisContext(\"globalThis.ResizeObserver.prototype.disconnect = () => {}\");\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/erased-known-global-channel.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "async-effect-does-not-return-owned-cleanup",
    code: "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(async () => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/async-effect-does-not-return-owned-cleanup.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
  {
    name: "known-function-literal-reflected-constructor-native-provider-mutation",
    code: "import { useEffect } from 'react';\n(() => {}).constructor(\"ResizeObserver.prototype.disconnect = () => {}\")();\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n",
    options: {
      filename: "/synthetic/deferred-observer/reflected-constructor-native-provider.tsx",
      settings: {
        "react-doctor": {
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedCount: 1,
  },
];

describe("effect-needs-cleanup native interval observer ownership", () => {
  for (const control of cases) {
    it(control.name, () => {
      const result = runRule(effectNeedsCleanup, control.code, control.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expectedCount);
    });
  }
});
