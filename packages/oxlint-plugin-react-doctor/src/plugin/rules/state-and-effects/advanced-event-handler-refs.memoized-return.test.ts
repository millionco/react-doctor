import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { advancedEventHandlerRefs } from "./advanced-event-handler-refs.js";

interface MemoizedReturnedHookCase {
  name: string;
  source: string;
  warnings: number;
  handler?: string;
}

const cases: MemoizedReturnedHookCase[] = [
  {
    name: "01-proven-private-memo-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "02-known-fresh-local-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => ({ onSignal: () => {} });\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "03-reactive-memo-dependencies",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = (value) => {\n const callback=useCallback(()=>{void value;},[value]);\n return {onSignal:callback};\n};\nconst Example = ({ value }) => {\n  const { onSignal } = useSignalBundle(value);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "04-mutable-hook-binding",
    source:
      'import { useCallback, useEffect } from "react";\nlet useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "05-hook-function-alias-escape",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst escapedHook = useSignalBundle;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "06-conditional-return",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n const callback=useCallback(()=>{},[]);\n if (flag) return {onSignal:callback};\n return {onSignal:()=>{}};\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "07-returned-getter",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n const callback=useCallback(()=>{},[]);\n return {get onSignal(){return callback;}};\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "08-return-spread-override",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n const callback=useCallback(()=>{},[]);\n return {onSignal:callback,...opaque};\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "09-shadowed-native-api",
    source:
      'import { useEffect } from "react";\nconst useCallback=(callback)=>callback;\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "10-imported-hook-still-opaque",
    source:
      'import {useSignalBundle} from "./provider";\nimport { useCallback, useEffect } from "react";\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "11-newly-proven-first-later-unstable-prop",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther }) => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onOther",
  },
  {
    name: "12-written-consumer-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  let { onSignal } = useSignalBundle();\n  onSignal = () => {};\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "13-legacy-direct-native-stable",
    source:
      'import { useCallback, useEffect } from "react";\nconst Example = () => {\n  const onSignal = useCallback(() => {}, []);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "14-legacy-stable-first-unstable-later",
    source:
      'import { useCallback, useEffect } from "react";\nconst Example = ({ onOther }) => {\n  const onSignal = useCallback(() => {}, []);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, onOther]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "15-type-only-api-import",
    source:
      'import type { useCallback } from "react";\nimport {useEffect} from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "16-alternate-namespace-provider-write",
    source:
      'import { useCallback, useEffect } from "react";\nimport * as React from "react";\nReact.useCallback = (callback) => callback;\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "17-isolated-zero-arg-nonempty-deps",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, [{}]);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "18-actual-inner-shadowed-listener",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther }) => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    const onSignal = onOther;\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal, onOther]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "19-prototype-setter-not-own-data-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { __proto__: callback };\n};\nconst Example = () => {\n  const { __proto__: onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "exported-provider",
    source:
      'import { useCallback, useEffect } from "react";\nexport const useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "exported-provider-specifier",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nexport { useSignalBundle };\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "default-exported-provider",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nexport default useSignalBundle;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "provider-parameters",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = (unused) => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "async-provider",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = async () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "additional-provider-statement",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  const extra = 1;\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "aliased-return",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  const alias = callback;\n  return { onSignal: alias };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "consumer-default",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal = () => {} } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "consumer-rest",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal, ...rest } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "consumer-computed",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { ["onSignal"]: onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "consumer-opaque-escape",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  expose(onSignal);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "provider-opaque-escape",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nexpose(useSignalBundle);\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "prior-conditional-exit",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  if (flag) return null;\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "conditional-consumer",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  let onSignal;\n  if (flag) { ({ onSignal } = useSignalBundle()); }\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "aliased-native-api",
    source:
      'import { useCallback, useEffect } from "react";\nconst cachedApi = useCallback;\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "foreign-native-api",
    source:
      'import { useEffect } from "react";\nimport {useCallback} from "foreign";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "specifier-type-only",
    source:
      'import { type useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "global-namespace-api",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = React.useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "dynamic-sdk-loader",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst facade = require("react");\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "dynamic-module-loader",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst load = import("react");\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "internal-sdk-capability",
    source:
      'import { useCallback, useEffect, __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "returned-computed-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { ["onSignal"]: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "returned-duplicate-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback, onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "second-provider-caller",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Other = () => useSignalBundle();\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "plain-shorthand-return-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const onSignal = useCallback(() => {}, []);\n  return { onSignal };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "renamed-direct-consumer-field",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal: handle } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", handle);\n    return () => {\n      window.removeEventListener("signal", handle);\n    };\n  }, [handle]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "indirect-eval-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\n(0, eval)("0");\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "aliased-eval-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst evaluate = eval;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "global-eval-member-alias",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst evaluate = globalThis.eval;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "destructured-global-eval-alias",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst { eval: evaluate } = globalThis; void evaluate;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "escaped-require-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst load = require;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "module-require-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst load = module.require;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "escaped-Function-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst compile = Function;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "constructor-derived-code-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst compile = (() => {}).constructor;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "destructured-constructor-code-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst { constructor: compile } = (() => {}); void compile;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "unknown-computed-code-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst compile = (() => {})[memberName];\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "explicit-node-module-loader",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nimport { createRequire as load } from "node:module";\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "explicit-node-vm-loader",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nimport { compileFunction as compile } from "node:vm";\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "explicit-node-builtin-loader",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst load = process.getBuiltinModule;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "reflective-constructor-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst compile = Reflect.get(() => {}, "constructor");\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "runtime-typed-Function-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst compile = (Function as Function);\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "runtime-enum-code-construction",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nenum Capability { Value = Function("return 1")() }\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "erased-code-capability-type",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\ntype CodeCapability = { constructor: Function; eval: typeof eval; require: typeof require };\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "erased-native-loader-type-import",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nimport type { Script } from "node:vm"; type Marker = Script;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "harmless-Function-annotation",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst annotation: Function | undefined = undefined;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "shadowed-Function-runtime-value",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Function = () => 0; void Function;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "memo-initializer-alias-is-not-direct-call",
    source:
      'import { useCallback, useEffect } from "react";\nconst external = useCallback(() => {}, []);\nconst useSignalBundle = () => {\n  const callback = external;\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "escaped-native-process-reference",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst nativeProcess = process;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "named-native-process-builtin-loader",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nimport { getBuiltinModule as load } from "node:process";\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "erased-native-process-loader-import",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nimport type { getBuiltinModule } from "node:process"; type Marker = typeof getBuiltinModule;\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
  {
    name: "triple-direct-memo",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useSignalBundle();\n  const legacy = useCallback(() => {}, []);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "triple-legacy-ref-current",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useSignalBundle();\n  const legacy = sourceRef.current;\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "triple-opaque-useEvent",
    source:
      'import { useEvent } from "opaque-events";\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useSignalBundle();\n  const legacy = useEvent(() => {});\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "legacy-named-destructured-provider-retains-warning",
    source:
      'import { useCallback, useEffect } from "react";\nconst useEvent = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useEvent();\n  const legacy = useCallback(() => {}, []);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "coordinated-triple-direct-memo",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useSignalBundle();\n  const legacy = useCallback(() => {}, []);\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "coordinated-triple-fresh-object-current",
    source:
      'import { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useSignalBundle();\n  const legacy = ({ current: () => {} }).current;\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "coordinated-triple-fresh-local-useEvent",
    source:
      'const useEvent = (callback) => () => callback();\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = ({ onOther, sourceRef }) => {\n  const { onSignal } = useSignalBundle();\n  const legacy = useEvent(() => {});\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    window.addEventListener("legacy", legacy);\n    window.addEventListener("other", onOther);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n      window.removeEventListener("legacy", legacy);\n      window.removeEventListener("other", onOther);\n    };\n  }, [onSignal, legacy, onOther]);\n  return null;\n};\n',
    warnings: 1,
    handler: "onSignal",
  },
  {
    name: "bound-loader-parameter-direct-call",
    source:
      'const run = (require) => require("react");\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "bound-loader-const-direct-call",
    source:
      'const require = loader; require("react");\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "bound-loader-parameter-aliased-reference",
    source:
      'const run = (require) => { const load = require; return load("react"); };\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "reflective-constructor-acquisition",
    source:
      'const compile = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value;\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 1,
  },
  {
    name: "harmless-object-keys",
    source:
      'const fields = Object.keys({ signal: true });\nimport { useCallback, useEffect } from "react";\nconst useSignalBundle = () => {\n  const callback = useCallback(() => {}, []);\n  return { onSignal: callback };\n};\nconst Example = () => {\n  const { onSignal } = useSignalBundle();\n  useEffect(() => {\n    window.addEventListener("signal", onSignal);\n    return () => {\n      window.removeEventListener("signal", onSignal);\n    };\n  }, [onSignal]);\n  return null;\n};\n',
    warnings: 0,
  },
];

describe("advanced-event-handler-refs memoized return fields", () => {
  it.each(cases)("preserves $name", ({ source, warnings, handler }) => {
    const result = runRule(advancedEventHandlerRefs, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(warnings);
    if (handler) expect(result.diagnostics[0]?.message).toContain('"' + handler + '"');
  });
});
