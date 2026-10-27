import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

interface StyledAuthCase {
  readonly name: string;
  readonly count: number;
  readonly editor: string;
  readonly controls: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly manifest?: Readonly<Record<string, string>>;
}

const cases: readonly StyledAuthCase[] = [
  {
    name: "plain-styled-form-canonical-password-post",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "plain-styled-string-factory",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled("form")``;\n',
  },
  {
    name: "named-default-styled-alias",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import { default as styled } from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "direct-get-auth-expression",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(getAuth(), "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "readonly-local-auth-alias",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nconst stableAuth = auth;\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(stableAuth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "strict-cross-file-auth-constant",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { auth } from "./session";\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "session.ts": 'import { getAuth } from "firebase/auth";\nexport const auth = getAuth();\n',
    },
  },
  {
    name: "strict-auth-barrel",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { auth } from "./session-barrel";\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "session.ts": 'import { getAuth } from "firebase/auth";\nexport const auth = getAuth();\n',
      "session-barrel.ts": 'export { auth } from "./session";\n',
    },
  },
  {
    name: "canonical-sdk-import-alias",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword as request } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await request(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "styled-native-button-click",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onClick={submit}>Continue</Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.button``;\n',
  },
  {
    name: "styled-host-with-existing-fetch-summary",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await fetch("/items", { method: "POST" });\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "canonical-sdk-on-ordinary-native-form",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <form onSubmit={submit}><button type="submit">Continue</button></form>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "pre-await-busy-guard",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [busy, setBusy] = useState(false);\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    if (busy) return;\n    setBusy(true);\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n    setBusy(false);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "no-after-await-state",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "unknown-auth-parameter",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nexport const CredentialsPanel = ({ auth }) => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "fake-auth-object",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = {};\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "opaque-auth-factory",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = makeAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "nonzero-get-auth-argument",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth({});\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "mutable-auth-binding",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nlet auth = getAuth();\nauth = {};\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "auth-object-property-write",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nauth._updateCurrentUser = () => {};\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "auth-value-escape",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nconsume(auth);\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "auth-origin-function-export",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { auth } from "./session";\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "session.ts":
        'import { getAuth } from "firebase/auth";\nexport const auth = () => getAuth();\n',
    },
  },
  {
    name: "local-sign-in-spelling",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nconst signInWithEmailAndPassword = async () => {};\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "foreign-sign-in-provider",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { signInWithEmailAndPassword } from "other-auth";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "wrong-sdk-name",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInAnonymously } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInAnonymously(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "sdk-function-property-write",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nsignInWithEmailAndPassword.call = () => {};\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "sdk-namespace-alternative",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport * as sdk from "firebase/auth";\nsdk.signInWithEmailAndPassword = () => {};\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "sdk-function-extraction",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst request = signInWithEmailAndPassword;\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await request(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "sdk-optional-call",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword?.(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "sdk-different-version",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    manifest: {
      firebase: "9.1.0",
    },
  },
  {
    name: "sdk-unknown-range-without-lock",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    manifest: {
      firebase: "^9.0.1",
    },
  },
  {
    name: "styled-different-major",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    manifest: {
      "styled-components": "6.0.0",
    },
  },
  {
    name: "named-styled-is-not-sc5-default",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import { styled } from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "foreign-styled-provider",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "other-style";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "styled-attrs-chain",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import styled from "styled-components";\nexport const Surface = styled.form.attrs({})``;\n',
  },
  {
    name: "styled-with-config",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import styled from "styled-components";\nexport const Surface = styled.form.withConfig({})``;\n',
  },
  {
    name: "styled-provider-write",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import styled from "styled-components";\nexport const Surface = styled.form``;\nstyled.form = replacement;\n',
  },
  {
    name: "styled-second-default-provider-write",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import styled from "styled-components";\nexport const Surface = styled.form``;\nimport second from "styled-components";\nsecond.form = replacement;\n',
  },
  {
    name: "styled-component-defaults-write",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nSurface.defaultProps = { disabled: true };\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "styled-host-polymorphic-prop",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface as="section" onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "styled-event-spread",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface {...extras} onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "styled-host-event-mismatch",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.button``;\n',
  },
  {
    name: "custom-build-script",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "firebase": "9.0.1", "styled-components": "5.3.1"}, "scripts": {"build": "node custom-builder.js"}}',
    },
  },
  {
    name: "typescript-sdk-module-remap",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"firebase/auth": ["./shim.ts"]}}}',
      "shim.ts":
        "export const getAuth=()=>({});\nexport const signInWithEmailAndPassword=async()=>{};\n",
    },
  },
  {
    name: "range-with-exact-canonical-lock",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    manifest: {
      firebase: "^9.0.1",
    },
    files: {
      "package-lock.json":
        '{"lockfileVersion": 3, "packages": {"": {"dependencies": {"react": "17.0.2", "firebase": "^9.0.1", "styled-components": "5.3.1"}}, "node_modules/firebase": {"version": "9.0.1", "resolved": "https://registry.npmjs.org/firebase/-/firebase-9.0.1.tgz", "integrity": "sha512-RMpbXsVlxqMX+s/gYudnUZeSZXPiLCJMdaxbZ0WRiMjLuJc6ZkbpRy7yz7rZQpL0wRD6gN4K5C+JaKEQtN3jAQ=="}}}',
    },
  },
  {
    name: "plain-craco-unrelated-source-alias",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "@/local": resolvePath("./src") } } };\n',
    },
  },
  {
    name: "craco-sdk-remap-refusal",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "firebase/auth": resolvePath("./src") } } };\n',
    },
  },
  {
    name: "installed-version-mismatch",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "node_modules/firebase/package.json": '{"name": "firebase", "version": "9.0.2"}',
    },
  },
  {
    name: "existing-forwardref-carrier-new-sdk-summary",
    count: 1,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls:
      'import { forwardRef } from "react";\nexport const Surface = forwardRef(({children,...props},ref)=><form ref={ref} {...props}>{children}</form>);\n',
  },
  {
    name: "global-runtime-provider-capability",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n\nFunction("return 0")();\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "internal-sdk-component-registry-provider",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n\nimport { _registerComponent } from "@firebase/app";\n_registerComponent(replacement);\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "public-app-private-component-registry",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n\nimport { _registerComponent } from "firebase/app";\n_registerComponent(replacement);\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "craco-exact-sdk-alias",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "firebase/auth$": resolvePath("./src") } } };\n',
    },
  },
  {
    name: "craco-exact-styled-alias",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "styled-components$": resolvePath("./src") } } };\n',
    },
  },
  {
    name: "craco-wildcard-sdk-alias",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "craco.config.js":
        'const path = require("path");\nconst resolvePath = value => path.resolve(__dirname, value);\nmodule.exports = { webpack: { alias: { "fire*": resolvePath("./src") } } };\n',
    },
  },
  {
    name: "same-export-auth-import-field-mutation",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { auth, auth as Other } from "./session";\nOther._getSdkClientVersion = () => { throw Error("blocked"); };\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "session.ts": 'import { getAuth } from "firebase/auth";\nexport const auth = getAuth();\n',
    },
  },
  {
    name: "same-export-auth-barrel-field-mutation",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { auth, auth as Other } from "./session-barrel";\nOther._getSdkClientVersion = () => { throw Error("blocked"); };\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "session.ts": 'import { getAuth } from "firebase/auth";\nexport const auth = getAuth();\n',
      "session-barrel.ts": 'export { auth } from "./session";\n',
    },
  },
  {
    name: "second-default-get-auth-instance-mutation",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nconst auth = getAuth();\nconst other = getAuth();\nother._getSdkClientVersion = () => { throw Error("blocked"); };\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
  },
  {
    name: "auth-namespace-carrier-mutation",
    count: 0,
    editor:
      'import { useState } from "react";\nimport { getAuth, signInWithEmailAndPassword } from "firebase/auth";\nimport { Surface } from "./controls";\nimport { auth } from "./session";\nimport * as Other from "./session";\nOther.auth._getSdkClientVersion = () => { throw Error("blocked"); };\nexport const CredentialsPanel = () => {\n  const [, setDone] = useState(false);\n  const submit = async event => {\n    event.preventDefault();\n    await signInWithEmailAndPassword(auth, "member@example.invalid", "value");\n    setDone(true);\n  };\n  return <Surface onSubmit={submit}><button type="submit">Continue</button></Surface>;\n};\n',
    controls: 'import styled from "styled-components";\nexport const Surface = styled.form``;\n',
    files: {
      "session.ts": 'import { getAuth } from "firebase/auth";\nexport const auth = getAuth();\n',
    },
  },
];

const withProject = (
  fixture: StyledAuthCase,
  inspect: (filename: string, directory: string) => void,
): void => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-styled-auth-"));
  const files = {
    "package.json": JSON.stringify({
      dependencies: {
        react: "17.0.2",
        firebase: "9.0.1",
        "styled-components": "5.3.1",
        ...fixture.manifest,
      },
    }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
    "editor.tsx": fixture.editor,
    "controls.tsx": fixture.controls,
    ...fixture.files,
  };
  try {
    for (const [relative, body] of Object.entries(files)) {
      const filename = path.join(directory, relative);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, body);
    }
    resetFilesystemCaches();
    inspect(path.join(directory, "editor.tsx"), directory);
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("canonical styled native controls and password sign-in", () => {
  for (const fixture of cases)
    it(fixture.name, () =>
      withProject(fixture, (filename) => {
        const result = runRule(noAsyncEventHandlerWithoutReentryGuard, fixture.editor, {
          filename,
        });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(fixture.count);
      }),
    );
  it("invalidates an edited exact SDK lock between passes", () => {
    const fixture = cases.find((value) => value.name === "range-with-exact-canonical-lock");
    expect(fixture).toBeDefined();
    if (!fixture) throw new Error("Missing lock control");
    withProject(fixture, (filename, directory) => {
      const inspect = () =>
        runRule(noAsyncEventHandlerWithoutReentryGuard, fixture.editor, { filename });
      expect(inspect().diagnostics).toHaveLength(1);
      const lockPath = path.join(directory, "package-lock.json");
      const lockSource = fs.readFileSync(lockPath, "utf8");
      const changed = lockSource.replace('"version": "9.0.1"', '"version": "9.0.2"');
      expect(changed).not.toBe(lockSource);
      fs.writeFileSync(lockPath, changed);
      resetFilesystemCaches();
      expect(inspect().diagnostics).toHaveLength(0);
      fs.writeFileSync(lockPath, lockSource);
      resetFilesystemCaches();
      expect(inspect().diagnostics).toHaveLength(1);
    });
  });
});
