import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const cases = [
  {
    name: "baseline-antd-loading-role",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 1,
    sourceSha256: "c25a5cd4775eacc5889a8b7eae43785257e59fd438f2bdbe3dab30e07d1f2381",
  },
  {
    name: "merged-antd-button-interface",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\ninterface Button {}\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 1,
    sourceSha256: "2c5f02ccdeba94694778fae11ca37f526eb520223b15620eb541c42e0c8a9860",
  },
  {
    name: "merged-react-hook-interface",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\ninterface useState {}\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 1,
    sourceSha256: "ca20844a244cfac2766792a436b33af3a16a9dbf08cf43c4f3962aa469eb9e83",
  },
  {
    name: "merged-state-interface",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  interface phase {}\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 1,
    sourceSha256: "dd5dd5a214339ae38c81d21e439343cbd1efe6366d3a1857a4d041228487d5ac",
  },
  {
    name: "merged-setter-interface",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  interface changePhase {}\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 1,
    sourceSha256: "f1678a176a3ce8c7dae1fe193a90ceb24d2094dfe1f14ed792edcf3e01e610c5",
  },
  {
    name: "legacy-named-loading-control",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, setLoading] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { setLoading(true); try { await performTask(); setLoading(false); } catch { changeMessage("Failed"); } };\n  return <button onClick={submit}>{phase ? "A" : "B"}</button>;\n};\n',
    expected: 1,
    sourceSha256: "038ccc9e7160ea1470db2e1ab9a0fa65b00dfde35e661f0f0981920677463f7b",
  },
  {
    name: "genuine-local-button-with-interface",
    code: 'import { useState } from "react";\nimport { performTask } from "./task-provider";\nconst Button = (properties: { loading: boolean; onClick: () => void; children: string }) => <span>{properties.children}</span>;\ninterface Button {}\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "4532968a20eaeb5f6d97dd5b70a411d7fef248d994435158cdfad7bd89c8be31",
  },
  {
    name: "unreachable-void-and-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return (void 0) && <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "a65fcb1a0ed897732025d9d703510543cac2c28bb42b85d4969de96ca01c43ba",
  },
  {
    name: "unreachable-negative-number-conditional",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return (-1) ? null : <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "c3ae370a173788fdeab3b89f5800bd241c1fa700cbffdb4e6049fd03ed08186b",
  },
  {
    name: "unreachable-not-false-or-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return (!false) || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "c52809894a066543e14387129b5049978eda79d49e77ae3db8000716984f2cfe",
  },
  {
    name: "unreachable-closed-template-or-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return `present` || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "118555b76514e8e9b0767bb83b35480480d31f507923616723b4e43286c51239",
  },
  {
    name: "dynamic-negated-state-and-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return !message && <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 1,
    sourceSha256: "3f398b7752652181c8a36690da938ae2aac642196f0e8bdd6f9b13b386167e6b",
  },
  {
    name: "existing-regex-selector-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return /sample/ || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "cfe74f1dacb5e5008d559971cbbdcdba053faeeda59522f30afaea8a74bc1e35",
  },
  {
    name: "existing-bigint-selector-declines",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return 0n || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "5ffd6d5c097824116ba890eab362df693e2ef783f678d8fa751cdf98540acc96",
  },
  {
    name: "unreachable-dynamic-operand-void-and-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return (void message) && <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "56f35fcea542a983e075ddaf2f4d389c5dc1c88bf5f23b2abe98e1aa625d994a",
  },
  {
    name: "unreachable-dynamic-operand-typeof-or-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return (typeof message) || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "00755f0c5b4aa40c7b9581fd0024a7fa1cecaa32980c57e4e78023686225c03f",
  },
  {
    name: "unreachable-object-value-or-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return ({ ready: message }) || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "6615f9bbaef3325fae198c036f7ba9c985c93c64ee485131dbcfedaf5284c7c7",
  },
  {
    name: "unreachable-array-value-or-button",
    code: 'import { useState } from "react";\nimport { Button } from "antd";\nimport { performTask } from "./task-provider";\nexport const TaskPanel = () => {\n  const [phase, changePhase] = useState(false);\n  const [message, changeMessage] = useState("");\n  const submit = async () => { changePhase(true); try { await performTask(); changePhase(false); } catch { changeMessage("Failed"); } };\n  return [message] || <Button loading={phase} onClick={submit}>Run</Button>;\n};\n',
    expected: 0,
    sourceSha256: "5873856125fe5a03ce90a428ec871ed705364a0f4ed78dc3ef903b4a8b8f2fa5",
  },
];

describe("AntD loading role review regressions", () => {
  it.each(cases)("$name", ({ name, code, expected }) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, code, {
      filename: `src/antd-loading-role-review/${name}.tsx`,
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
