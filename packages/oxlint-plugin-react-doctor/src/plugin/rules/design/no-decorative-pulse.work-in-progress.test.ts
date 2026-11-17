import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { noDecorativePulse } from "./no-decorative-pulse.js";
import { isOwnedAsyncResultPlaceholder } from "./utils/is-owned-async-result-placeholder.js";

const cases = [
  {
    name: "01-owned-pending-result-placeholder",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "02-renamed-state-and-task",
    source:
      'import { useEffect, useState } from "react";\nimport { performStep } from "./task";\nconst Example = () => {\n  const [phase, finishPhase] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const entryValue = await performStep();\n        setResult(entryValue);\n      } catch {\n      } finally {\n        finishPhase(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{phase ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "03-opaque-task-no-liveness-claim",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./opaque-task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "04-opaque-jsx-carrier-source-role",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nimport { Frame } from "./frame";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <Frame>{pending ? <span className="animate-pulse">...</span> : result}</Frame>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "05-rejection-keeps-cached-result",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch (error) {\n        console.warn(error);\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "06-constant-attention-flag",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const pending = true;\n  const setPending = (value) => value;\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "07-misleading-loading-name-without-await",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [isLoading, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = "unchanging";\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{isLoading ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "08-worker-never-invoked",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "09-conditionally-invoked-worker",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    if (enabled) void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "10-setter-escape",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  expose(setPending);\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "11-reset-true-after-settlement",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  const reset = () => setPending(true);\n  return <section onClick={reset}>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "12-no-finally-success-only-clear",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      const loaded = await readEntry();\n      setResult(loaded);\n      setPending(false);\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "13-pulse-in-settled-arm",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? result : <span className="animate-pulse">...</span>}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "14-shadowed-guard-symbol",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{(() => { const pending = true; return pending ? <span className="animate-pulse">...</span> : result; })()}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "15-no-awaited-result-alternate-link",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : "finished"}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "16-aliased-pending-setter",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  const finish = setPending;\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        finish(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "17-wrong-await-result-write",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult("unrelated");\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "18-worker-escape",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    expose(run);\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "19-foreign-state-provider",
    source:
      'import { useEffect } from "react";\nimport { useState } from "foreign-state";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "20-other-pulse-sibling-stays-warned",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}<span className="animate-pulse">Offer</span></section>;\n};\n',
    expectedDiagnostics: 1,
    expectedLocation: {
      line: 18,
      column: 81,
      nodeType: "JSXOpeningElement",
    },
  },
  {
    name: "21-existing-aria-status-exemption",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span role="status" className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "22-existing-busy-text-exemption",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">Loading</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "23-stable-hero-copy-remains-warned",
    source: 'const Hero = () => <h1 className="animate-pulse">Explore more</h1>;\n',
    expectedDiagnostics: 1,
  },
  {
    name: "24-legacy-fake-cursor-hero-remains-warned",
    source: 'const Hero = () => <h1><span className="animate-pulse">|</span>Explore</h1>;\n',
    expectedDiagnostics: 1,
  },
  {
    name: "25-worker-before-try-early-return",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      if (skip) return;\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "26-try-before-await-early-return",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        if (skip) return;\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "27-conditional-finally-clear",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        if (allowClear) setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "28-uninvoked-finally-clear-closure",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        const clearPhase = () => setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "29-second-direct-worker-invocation",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "30-extra-result-writer",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n        setEntry("alternate");\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "31-direct-lexical-eval-writer",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  eval("setInFlight(true)");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "32-type-only-state-import",
    source:
      'import { useEffect } from "react";\nimport type { useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "33-local-shadow-effect-provider",
    source:
      'import { useState } from "react";\nconst useEffect = (callback, dependencies) => undefined;\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "34-visible-react-facade-replacement",
    source:
      'import React, { useEffect, useState } from "react";\nimport { replacementState } from "./alternative";\nReact.useState = replacementState;\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "35-selected-placeholder-spread",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse" {...extra}>...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "36-selected-placeholder-dynamic-child",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse">...{caption}</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "37-selected-placeholder-interactive",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse" onClick={() => undefined}>...</span> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "38-placeholder-nested-inside-positive-branch",
    source:
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <div><span className="animate-pulse">...</span></div> : entry}</main>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "39-owner-return-before-effect-registration",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "40-owner-conditional-exit-is-unsupported",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = ({ skip }) => {\n  const [pending, setPending] = useState(true);\n  const [result, setResult] = useState("cached");\n  if (skip) return null;\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "41-state-declarator-sibling-is-unsupported",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [pending, setPending] = useState(true), ignored = undefined;\n  const [result, setResult] = useState("cached");\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "42-result-state-declared-before-pending",
    source:
      'import { useEffect, useState } from "react";\nimport { readEntry } from "./task";\nconst Example = () => {\n  const [result, setResult] = useState("cached");\n  const [pending, setPending] = useState(true);\n  useEffect(() => {\n    const run = async () => {\n      try {\n        const loaded = await readEntry();\n        setResult(loaded);\n      } catch {\n      } finally {\n        setPending(false);\n      }\n    };\n    void run();\n  }, []);\n  return <section>{pending ? <span className="animate-pulse">...</span> : result}</section>;\n};\n',
    expectedDiagnostics: 0,
  },
];

describe("no-decorative-pulse owned pending result", () => {
  it.each(cases)("preserves $name", ({ source, expectedDiagnostics, expectedLocation }) => {
    const result = runRule(noDecorativePulse, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    if (expectedLocation) expect(result.diagnostics[0]).toMatchObject(expectedLocation);
  });

  it("declines a selected spread even when the existing class gate is quiet", () => {
    const certificateProbe = defineRule({
      id: "owned-placeholder-probe",
      severity: "warn",
      create: (context) => ({
        JSXElement: (element: EsTreeNodeOfType<"JSXElement">) => {
          if (isOwnedAsyncResultPlaceholder(element, context.scopes)) {
            context.report({ node: element, message: "Owned placeholder certificate" });
          }
        },
      }),
    });
    const result = runRule(
      certificateProbe,
      'import { useEffect, useState } from "react";\nimport { requestSnapshot } from "./operation";\nconst StatusPreview = ({ skip, allowClear, caption, extra }) => {\n  const [inFlight, setInFlight] = useState(true);\n  const [entry, setEntry] = useState("previous");\n  useEffect(() => {\n    const resolveEntry = async () => {\n      try {\n        const fetchedEntry = await requestSnapshot();\n        setEntry(fetchedEntry);\n      } catch {\n      } finally {\n        setInFlight(false);\n      }\n    };\n    void resolveEntry();\n  }, []);\n  return <main>{inFlight ? <span className="animate-pulse" {...extra}>...</span> : entry}</main>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
