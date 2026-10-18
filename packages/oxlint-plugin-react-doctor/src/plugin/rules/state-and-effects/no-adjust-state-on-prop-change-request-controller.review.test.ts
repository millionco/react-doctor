import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("request controller runtime bindings and abort provider", () => {
  it.each([
    {
      name: "nominal-local-controller",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "erased-local-controller-interface",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    interface controller { readonly tag: string; }\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "erased-abort-controller-interface",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ninterface AbortController { readonly tag: string; }\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "erased-native-map-interface",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ninterface Map<Key, Value> extends globalThis.Map<Key, Value> {}\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "erased-native-set-interface",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ninterface Set<Value> extends globalThis.Set<Value> {}\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "unsafe-abort-with-erased-use-effect",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  interface useEffect { readonly tag: string; }\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.inspect());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "real-local-controller-plus-interface",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const AbortController = FakeController;\n    interface AbortController { readonly tag: string; }\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "selected-native-abort-prototype-write",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nAbortController.prototype.abort = () => {};\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "readonly-native-abort-prototype",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nvoid AbortController.prototype.abort;\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "foreign-constructor-prototype-write",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nOtherController.prototype.abort = () => {};\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "genuine-local-constructor-with-erased-interface",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nconst unrelated = (AbortController) => { interface AbortController { readonly tag: string; } AbortController.prototype.abort = () => {}; };\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "component-abort-prototype-write",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  AbortController.prototype.abort = () => {};\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "component-readonly-abort-prototype",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  void AbortController.prototype.abort;\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "erased-interface-with-selected-abort-write",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ninterface AbortController { readonly tag: string; }\nAbortController.prototype.abort = () => {};\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "erased-interface-with-readonly-abort",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ninterface AbortController { readonly tag: string; }\nvoid AbortController.prototype.abort;\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "erased-type-alias-with-selected-abort-write",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ntype AbortController = { readonly tag: string };\nAbortController.prototype.abort = () => {};\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "erased-type-alias-with-readonly-abort",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\ntype AbortController = { readonly tag: string };\nvoid AbortController.prototype.abort;\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
    {
      name: "component-post-registration-abort-write",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  AbortController.prototype.abort = () => {};\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "component-post-registration-readonly-abort",
      code: '// rule: no-adjust-state-on-prop-change\n// weakness: alias-guard\n// source: synthetic\n// verdict: pass\nimport { useEffect, useRef, useState } from "react";\n\nexport const RequestRows = ({ query }) => {\n  const pending = useRef(new Map());\n  const [loading, setLoading] = useState(new Set());\n  const start = (requestKey) => {\n    const controller = new AbortController();\n    pending.current.set(requestKey, { controller });\n    setLoading((previous) => new Set(previous).add(requestKey));\n    fetch("/items", { signal: controller.signal });\n  };\n  useEffect(() => {\n    pending.current.forEach((entry) => entry.controller.abort());\n    pending.current.clear();\n    setLoading(new Set());\n  }, [query]);\n  void AbortController.prototype.abort;\n  return <button onClick={() => start("item")}>{loading.size}</button>;\n};\n',
      expected: 0,
    },
  ])("checks $name", ({ code, expected }) => {
    const result = runRule(noAdjustStateOnPropChange, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
