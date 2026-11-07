import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativePulse } from "./no-decorative-pulse.js";

const cases = [
  {
    name: "owned-pending",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 0,
  },
  {
    name: "direct-leaf",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <span className="animate-pulse">Thinking!</span>}\n  </section>;\n}\n',
    expectedDiagnostics: 0,
  },
  {
    name: "literal-map-event",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    {suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 0,
  },
  {
    name: "intrinsic-keyboard-event",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <input onKeyDown={(event) => { if (event.key === "Enter") send("Send"); }} />\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 0,
  },
  {
    name: "exact-visible-status-symbol-suffix",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking�!</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 0,
  },
  {
    name: "promotional-copy",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Upgrade now</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "copy-with-extra-words",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking about an upgrade</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "inverted-gate",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {!busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "conditional-ui",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy ? <div className="animate-pulse">Thinking…</div> : null}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "unrelated-gate",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {other && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "custom-wrapper",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <Frame><div className="animate-pulse">Thinking…</div></Frame>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "wrapper-has-other-child",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div><strong>Upgrade</strong></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "unawaited-request",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "arbitrary-sync-pulse",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = "queued";\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "await-zero",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await 0;\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "await-undefined",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await undefined;\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "await-resolved-promise",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await Promise.resolve();\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "finally-not-exclusive",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      if (other) setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "missing-finally",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    }\n    setBusy(false);\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "escaped-setter",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    extra(setBusy);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "escaped-handler",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  extra(send);\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "different-handlers",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    }\n  };\n  const clear = () => {\n    setBusy(false);\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "no-busy-exit",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "deferred-handler-call",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => setTimeout(() => send("Send"))} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "jsx-handler-not-native",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <Button onClick={() => send("Send")}>Send</Button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "status-and-decorative-neighbor",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n    <div className="animate-pulse">Thinking…</div>\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "other-provider",
    source:
      'import { useState } from "./react-shim";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "sibling-toggle-writer",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section><button onClick={() => setBusy(!busy)}>Toggle</button>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "nonliteral-map-owner",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = extra();\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    {suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "escaped-literal-map-source",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  extra(suggestions);\n  return <section>\n    {suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "jsx-handler-read-during-effect",
    source:
      'import { useEffect, useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  const trigger = <button onClick={send}>Send</button>;\n  useEffect(() => trigger.props.onClick(), []);\n  return <section>\n    {trigger}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "jsx-handler-bound-before-return",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  const trigger = <button onClick={send}>Send</button>;\n  return <section>\n    {trigger}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "jsx-handler-through-call",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    {extra(<button onClick={send}>Send</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "jsx-handler-under-opaque-host",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <Frame><button onClick={send}>Send</button></Frame>\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "pulse-under-opaque-host",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    <button onClick={() => send("Send")} disabled={busy}>Send</button>\n    {busy && <div className="row"><Frame><div className="animate-pulse">Thinking…</div></Frame></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "array-map-prototype-mutation",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nArray.prototype.map = (run) => [run("Send").props.onClick()];\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    {suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "array-map-prototype-alias-mutation",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst prototype = Object.getPrototypeOf([]);\nprototype.map = (run) => [run("Send").props.onClick()];\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    {suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "array-map-computed-prototype-mutation",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nglobalThis["Array"]["prototype"]["map"] = (run) => [run("Send").props.onClick()];\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <section>\n    {suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>)}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
  {
    name: "array-map-result-bound-before-return",
    source:
      'import { useState } from "react";\nimport { requestAnswer } from "./operation";\nconst suggestions = ["Send", "Explain"];\nexport function Panel({ available, other, extra }) {\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState(null);\n  const send = async (label) => {\n    if (!available || busy) return;\n    setBusy(true);\n    setError(null);\n    try {\n      const answer = await requestAnswer(label);\n      if (!answer) setError("Unavailable");\n    } catch {\n      setError("Error");\n    } finally {\n      setBusy(false);\n    }\n  };\n  const buttons = suggestions.map((label) => <button onClick={() => send(label)}>{label}</button>);\n  return <section>\n    {buttons}\n    {busy && <div className="row"><div className="animate-pulse">Thinking…</div></div>}\n  </section>;\n}\n',
    expectedDiagnostics: 1,
  },
];

describe("no-decorative-pulse event pending ownership", () => {
  it.each(cases)("$name", ({ source, expectedDiagnostics }) => {
    const result = runRule(noDecorativePulse, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});

describe("effective native pending triggers", () => {
  it.each([
    [
      "a spread that removes the handler",
      "<button onClick={send} {...{ onClick: undefined }}>Send</button>",
      1,
    ],
    [
      "a spread without an event override",
      '<button onClick={send} {...{ id: "send" }}>Send</button>',
      0,
    ],
    ["a native disabled button", "<button disabled onClick={send}>Send</button>", 1],
    [
      "a disabled fieldset",
      "<fieldset disabled><button onClick={send}>Send</button></fieldset>",
      1,
    ],
    [
      "a fieldset with effective disabled=false",
      "<fieldset disabled {...{ disabled: false }}><button onClick={send}>Send</button></fieldset>",
      0,
    ],
    [
      "the first literal legend",
      "<fieldset disabled><legend><button onClick={send}>Send</button></legend></fieldset>",
      0,
    ],
    [
      "a later legend",
      "<fieldset disabled><legend>Other</legend><legend><button onClick={send}>Send</button></legend></fieldset>",
      1,
    ],
  ])("handles %s", (_name, trigger, expectedDiagnostics) => {
    const result = runRule(
      noDecorativePulse,
      `import { useState } from "react";
import { requestAnswer } from "./operation";
export function Panel() {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try { await requestAnswer(); } finally { setBusy(false); }
  };
  return <section>
    ${trigger}
    {busy && <div className="animate-pulse">Thinking…</div>}
  </section>;
}`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});

describe("statically inactive native pending triggers", () => {
  it.each([
    {
      name: "disabled const",
      setup: "const blocked = true;",
      trigger: "<button disabled={blocked} onClick={send} />",
      expected: 1,
    },
    {
      name: "enabled const",
      setup: "const blocked = false;",
      trigger: "<button disabled={blocked} onClick={send} />",
      expected: 0,
    },
    {
      name: "dynamic state",
      setup: "const [blocked] = useState(true);",
      trigger: "<button disabled={blocked} onClick={send} />",
      expected: 0,
    },
    {
      name: "literal false branch",
      setup: "",
      trigger: "{false && <button onClick={send} />}",
      expected: 1,
    },
    {
      name: "literal true branch",
      setup: "",
      trigger: "{true && <button onClick={send} />}",
      expected: 0,
    },
    {
      name: "hidden input",
      setup: "",
      trigger: '<input type="hidden" onKeyDown={() => send()} />',
      expected: 1,
    },
    {
      name: "text input",
      setup: "",
      trigger: '<input type="text" onKeyDown={() => send()} />',
      expected: 0,
    },
    {
      name: "inert React 19.2 ancestor",
      setup: "",
      trigger: "<div inert><button onClick={send} /></div>",
      expected: 1,
    },
    {
      name: "inert React 18 ancestor",
      setup: "",
      trigger: "<div inert><button onClick={send} /></div>",
      reactCapability: "react:18",
      expected: 0,
    },
    {
      name: "inert with only React 19 major metadata",
      setup: "",
      trigger: "<div inert><button onClick={send} /></div>",
      reactCapability: "react:19",
      expected: 0,
    },
    {
      name: "inert false",
      setup: "",
      trigger: "<div inert={false}><button onClick={send} /></div>",
      expected: 0,
    },
    {
      name: "dialog can escape ancestor inertness",
      setup: "",
      trigger: "<div inert><dialog><button onClick={send} /></dialog></div>",
      expected: 0,
    },
    {
      name: "dialog directly inert",
      setup: "",
      trigger: "<dialog inert><button onClick={send} /></dialog>",
      expected: 1,
    },
    {
      name: "hidden can be styled back into view",
      setup: "",
      trigger: '<div hidden style={{ display: "block" }}><button onClick={send} /></div>',
      expected: 0,
    },
    {
      name: "hidden can be revealed",
      setup: "",
      trigger: '<div hidden="until-found"><button onClick={send} /></div>',
      expected: 0,
    },
  ])("handles $name", ({ setup, trigger, reactCapability = "react:19.2", expected }) => {
    const result = runRule(
      noDecorativePulse,
      `import { useState } from "react";
import { requestAnswer } from "./operation";
export function Panel() {
  ${setup}
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try { await requestAnswer(); } finally { setBusy(false); }
  };
  return <section>
    ${trigger}
    {busy && <div className="animate-pulse">Thinking…</div>}
  </section>;
}`,
      {
        forceJsx: true,
        settings: { "react-doctor": { capabilities: ["react", reactCapability] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
