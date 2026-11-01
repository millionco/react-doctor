import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

interface LoadingRoleCase {
  name: string;
  code: string;
  options: Parameters<typeof runRule>[2];
  expectedCount: number;
}

const cases: ReadonlyArray<LoadingRoleCase> = [
  {
    name: "canonical-button-loading-unnamed-setter",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/canonical-button-loading-unnamed-setter.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "renamed-canonical-button-import",
    code: 'import { useState } from "react";\nimport { Button as ActionButton } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <ActionButton loading={phase} onClick={submit}>Run</ActionButton>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/renamed-canonical-button-import.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "finally-reset-safe",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); } finally { changePhase(false); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/finally-reset-safe.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "mirrored-catch-reset-safe",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changePhase(false); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/mirrored-catch-reset-safe.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "no-affirmative-loading-ui-role",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <button onClick={submit}>{phase ? "A" : "B"}</button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/no-affirmative-loading-ui-role.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "local-same-name-button-abstain",
    code: 'import { useState } from "react";\nimport { performTask } from "./task-provider";\nconst Button = (properties: { loading: boolean; onClick: () => void; children: string }) => <span>{properties.children}</span>;\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/local-same-name-button-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "unknown-component-loading-prop-abstain",
    code: 'import { useState } from "react";\nimport { Widget } from "./widget";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Widget loading={phase} onClick={submit} />;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/unknown-component-loading-prop-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "different-state-ui-consumer-abstain",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false); const [otherPhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={otherPhase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/different-state-ui-consumer-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "no-suspension-abstain",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); changePhase(false); };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/no-suspension-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "truthy-set-after-await-safe",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { await performTask(); changePhase(true); changePhase(false); };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/truthy-set-after-await-safe.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "legacy-loading-name-remains-positive",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, setLoading] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { setLoading(true); try { await performTask(); setLoading(false); } catch { changeMessage("Failed"); } };\n  return <button onClick={submit}>{phase ? "A" : "B"}</button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/legacy-loading-name-remains-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "later-spread-overrides-loading-abstain",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  const overrides = { loading: false }; return <Button loading={phase} onClick={submit} {...overrides}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/later-spread-overrides-loading-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "duplicate-loading-attribute-abstain",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} loading={false} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/duplicate-loading-attribute-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "unrelated-boolean-return-expression-abstain",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={Boolean(phase)} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/uncovered-next/loading-ui/unrelated-boolean-return-expression-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "native-aria-busy-role",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <button aria-busy={phase} onClick={submit}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/native-aria-busy-role.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "conditional-reset-still-risky",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { if (message) changePhase(false); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/uncovered-next/loading-ui/conditional-reset-still-risky.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "unused-native-library-widget-is-not-rendered-ui",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  const unusedPreview=<Button loading={phase} onClick={submit}>Run</Button>;\n  void unusedPreview;\n  return <button onClick={submit}>Run</button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-loading-ui/unused-native-library-widget-is-not-rendered-ui.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "catch-reset-helper-keeps-exceptional-reset-proof",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const clearPhase=()=>changePhase(false);\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { clearPhase(); changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-loading-ui/catch-reset-helper-keeps-exceptional-reset-proof.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "type-only-antd-binding-does-not-establish-value-role",
    code: 'import { useState } from "react";\nimport type { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-loading-ui/type-only-antd-binding-does-not-establish-value-role.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "unbound-hook-spelling-is-not-native-react-state",
    code: 'import { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-loading-ui/unbound-hook-spelling-is-not-native-react-state.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "visible-button-object-render-replacement-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nButton.render=()=>null;\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-loading-ui/visible-button-object-render-replacement-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "selected-setter-opaque-transport-declines-new-role",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  installReset(changePhase);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-loading-ui/selected-setter-opaque-transport-declines-new-role.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "returned-native-and-shorthand-logical-branch",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <div>{message ? <><Button loading={phase} onClick={submit}>Run</Button></> : null}</div>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/returned-native-and-shorthand-logical-branch.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "opaque-custom-ancestor-is-not-returned-native-ui",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { Shell } from "./shell";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Shell><Button loading={phase} onClick={submit}>Run</Button></Shell>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/opaque-custom-ancestor-is-not-returned-native-ui.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "secondary-react-namespace-provider-write-declines",
    code: 'import { useState } from "react";\nimport * as ReactRuntime from "react";\nReactRuntime.useState=()=>[false,()=>{}];\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/antd-loading-role/secondary-react-namespace-provider-write-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "antd-namespace-provider-write-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport * as Widgets from "antd";\nWidgets.Button.render=()=>null;\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/antd-namespace-provider-write-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "setter-alias-transport-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const otherChange=changePhase;\n  void otherChange;\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/setter-alias-transport-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "rebound-state-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  let [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  phase=false;\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/rebound-state-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-value-shadow-keeps-runtime-state",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  interface phase {}\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/erased-value-shadow-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "runtime-eval-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  eval("void 0");\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/runtime-eval-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "ambient-provider-declaration-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\ndeclare const toolkit: unknown;\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/ambient-provider-declaration-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "native-customized-built-in-ancestor-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <div is="opaque-shell"><Button loading={phase} onClick={submit}>Run</Button></div>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/native-customized-built-in-ancestor-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "named-react-namespace-hook-is-value-proven",
    code: 'import * as ReactRuntime from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = ReactRuntime.useState(false);\n  const [message, changeMessage] = ReactRuntime.useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/named-react-namespace-hook-is-value-proven.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "nonboolean-native-state-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState("");\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/nonboolean-native-state-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "type-only-react-hook-is-not-value-provider",
    code: 'import type { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/type-only-react-hook-is-not-value-provider.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "compatible-runtime-is-outside-react-only-profile",
    code: 'import { useState } from "preact/hooks";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-loading-role/compatible-runtime-is-outside-react-only-profile.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "discarded-loading-button-left-and-null",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button> && null;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-return-flow/discarded-loading-button-left-and-null.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "literal-false-and-loading-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return false && <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-return-flow/literal-false-and-loading-button.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "literal-true-or-loading-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return true || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-return-flow/literal-true-or-loading-button.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "literal-true-conditional-excludes-loading-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return true ? null : <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-return-flow/literal-true-conditional-excludes-loading-button.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "loading-button-left-or-null",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button> || null;\n};\n',
    options: {
      filename: "/synthetic/independent-antd-loading-return-flow/loading-button-left-or-null.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "literal-false-or-loading-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return false || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-return-flow/literal-false-or-loading-button.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "literal-true-and-loading-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return true && <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename: "/synthetic/antd-return-flow/literal-true-and-loading-button.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 1,
  },
  {
    name: "regex-or-loading-button-is-not-a-return-witness",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return /sample/ || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-literal/regex-or-loading-button-is-not-a-return-witness.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
  {
    name: "bigint-literal-selector-outside-finite-primitive-profile",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return 0n || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    options: {
      filename:
        "/synthetic/independent-antd-loading-literal/bigint-literal-selector-outside-finite-primitive-profile.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    },
    expectedCount: 0,
  },
];

describe("AntD loading state role", () => {
  it.each(cases)("$name", ({ code, options, expectedCount }) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
