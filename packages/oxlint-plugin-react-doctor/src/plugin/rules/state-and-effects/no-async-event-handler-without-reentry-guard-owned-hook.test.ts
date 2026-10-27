import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

interface OwnHookEdit {
  readonly file: string;
  readonly before: string;
  readonly after: string;
}
interface OwnHookFixture {
  readonly name: string;
  readonly count: number;
  readonly edits: ReadonlyArray<OwnHookEdit>;
  readonly files: Readonly<Record<string, string>>;
}
interface CapturedHookReport {
  readonly filename: string | undefined;
  readonly node: EsTreeNode;
  readonly program: EsTreeNode;
}

const BASE_FILES: Readonly<Record<string, string>> = {
  "package.json": '{"dependencies": {"react": "18.2.0", "styled-components": "5.3.11"}}',
  "tsconfig.json": '{"compilerOptions": {"jsx": "react-jsx"}}',
  "delivery.tsx":
    'import { useState } from "react";\n\nexport const useDelivery = (validate) => {\n  const [form, setForm] = useState({ values: { value: "ready" }, issues: {} });\n  const submit = async event => {\n    event.preventDefault();\n    const values = form.values;\n    const issues = validate(values);\n    setForm(previous => ({ ...previous, issues }));\n    if (Object.values(issues).every(error => error === "")) {\n      const response = await fetch("/messages", { method: "POST" });\n      if (response.ok) setForm({ values: { value: "" }, issues: {} });\n    }\n  };\n  return { submit, value: form.values.value };\n};\n',
  "view.tsx":
    'import { useDelivery } from "./delivery";\nimport validate from "./validator";\nimport { Form } from "./controls";\n\nexport const Panel = () => {\n  const { submit, value } = useDelivery(validate);\n  return <Form onSubmit={submit}><input value={value} readOnly /><button type="submit">Send</button></Form>;\n};\n',
  "validator.ts":
    'interface Fields { value: string }\nexport default function validate(fields: Fields) {\n  let errors = {} as { value?: string };\n  if (!fields.value) errors.value = "Required";\n  else if (!/^[a-z]+$/.test(fields.value)) errors.value = "Invalid";\n  return errors;\n}\n',
  "controls.tsx": 'import styled from "styled-components";\nexport const Form = styled.form``;\n',
};

const cases: ReadonlyArray<OwnHookFixture> = [
  {
    name: "primitive root null is not validation record",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: null",
      },
    ],
    files: {},
  },
  {
    name: "primitive root string is not validation record",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: 'values: "ready"',
      },
    ],
    files: {},
  },
  {
    name: "primitive root boolean is not validation record",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: true",
      },
    ],
    files: {},
  },
  {
    name: "default validator let record and literal regexp",
    count: 1,
    edits: [],
    files: {},
  },
  {
    name: "intrinsic form publication",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: "<Form onSubmit={submit}>",
        after: "<form onSubmit={submit}>",
      },
      {
        file: "view.tsx",
        before: "</Form>",
        after: "</form>",
      },
    ],
    files: {},
  },
  {
    name: "named import and projected binding aliases",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: "{ useDelivery }",
        after: "{ useDelivery as useMessages }",
      },
      {
        file: "view.tsx",
        before: "useDelivery(validate)",
        after: "useMessages(validate)",
      },
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: "{ submit: send, value }",
      },
      {
        file: "view.tsx",
        before: "onSubmit={submit}",
        after: "onSubmit={send}",
      },
    ],
    files: {},
  },
  {
    name: "strict hook barrel",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: 'from "./delivery"',
        after: 'from "./delivery-barrel"',
      },
    ],
    files: {
      "delivery-barrel.ts": 'export { useDelivery } from "./delivery";\n',
    },
  },
  {
    name: "local finite validator",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: 'import validate from "./validator";',
        after:
          'const validate = fields => { const errors = {}; if (!fields.value) errors.value = "Required"; return errors; };',
      },
    ],
    files: {},
  },
  {
    name: "named finite validator",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: 'import validate from "./validator";',
        after: 'import { check as validate } from "./validator";',
      },
    ],
    files: {
      "validator.ts":
        'export const check = fields => { const errors = {}; if (!fields.value) errors.value = "Required"; return errors; };\n',
    },
  },
  {
    name: "only published member selected",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: "  return { submit, value: form.values.value };",
        after:
          '  const other = async () => { await fetch("/unused", { method: "POST" }); setForm({ values: { value: "" }, issues: {} }); };\n  return { submit, other, value: form.values.value };',
      },
    ],
    files: {},
  },
  {
    name: "own styled submit button with absent click prop",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: 'import { Form } from "./controls";',
        after: 'import { Form } from "./controls";\nimport { Action } from "./action";',
      },
      {
        file: "view.tsx",
        before: '<button type="submit">Send</button>',
        after: "<Action>Send</Action>",
      },
    ],
    files: {
      "controls.tsx":
        'import styled from "styled-components";\nexport const Form = styled.form``;\nexport const NativeAction = styled.button``;\n',
      "action.tsx":
        'import { NativeAction } from "./controls";\nexport const Action = ({ children, onClick }) => <NativeAction onClick={onClick}>{children}</NativeAction>;\n',
    },
  },
  {
    name: "own intrinsic submit button with absent click prop",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: 'import { Form } from "./controls";',
        after: 'import { Form } from "./controls";\nimport { Action } from "./action";',
      },
      {
        file: "view.tsx",
        before: '<button type="submit">Send</button>',
        after: "<Action>Send</Action>",
      },
    ],
    files: {
      "action.tsx":
        "export const Action = ({ children, onClick }) => <button onClick={onClick}>{children}</button>;\n",
    },
  },
  {
    name: "leading owner ref guard stays quiet",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "{ useState }",
        after: "{ useState, useRef }",
      },
      {
        file: "delivery.tsx",
        before: "  const [form, setForm]",
        after: "  const pending = useRef(false);\n  const [form, setForm]",
      },
      {
        file: "delivery.tsx",
        before: "    event.preventDefault();",
        after:
          "    event.preventDefault();\n    if (pending.current) return;\n    pending.current = true;",
      },
    ],
    files: {},
  },
  {
    name: "no post await setter stays quiet",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'if (response.ok) setForm({ values: { value: "" }, issues: {} });',
        after: "if (response.ok) void response;",
      },
    ],
    files: {},
  },
  {
    name: "ordinary exported factory is not a Hook",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "useDelivery",
        after: "createDelivery",
      },
      {
        file: "view.tsx",
        before: "useDelivery",
        after: "createDelivery",
      },
    ],
    files: {},
  },
  {
    name: "no event publication",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "onSubmit={submit}",
        after: "",
      },
    ],
    files: {},
  },
  {
    name: "unknown validator parameter",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: 'import validate from "./validator";',
        after: "",
      },
      {
        file: "view.tsx",
        before: "Panel = ()",
        after: "Panel = ({ validate })",
      },
    ],
    files: {},
  },
  {
    name: "serializing validator capture",
    count: 0,
    edits: [],
    files: {
      "validator.ts":
        'let locked = false;\nexport default fields => { const errors = {}; if (locked) errors.value = "Pending"; locked = true; return errors; };\n',
    },
  },
  {
    name: "validator opaque call",
    count: 0,
    edits: [
      {
        file: "validator.ts",
        before: "  if (!fields.value)",
        after: "  unknown();\n  if (!fields.value)",
      },
    ],
    files: {},
  },
  {
    name: "validator error record rebind",
    count: 0,
    edits: [
      {
        file: "validator.ts",
        before: "  return errors;",
        after: "  errors = {};\n  return errors;",
      },
    ],
    files: {},
  },
  {
    name: "validator parameter write",
    count: 0,
    edits: [
      {
        file: "validator.ts",
        before: "  return errors;",
        after: '  fields.value = "changed";\n  return errors;',
      },
    ],
    files: {},
  },
  {
    name: "validator computed error field",
    count: 0,
    edits: [
      {
        file: "validator.ts",
        before: 'errors.value = "Required"',
        after: 'errors[fields.value] = "Required"',
      },
    ],
    files: {},
  },
  {
    name: "validator default parameter",
    count: 0,
    edits: [
      {
        file: "validator.ts",
        before: "fields: Fields",
        after: 'fields: Fields = { value: "" }',
      },
    ],
    files: {},
  },
  {
    name: "validator record escape",
    count: 0,
    edits: [
      {
        file: "validator.ts",
        before: "  return errors;",
        after: "  unknown(errors);\n  return errors;",
      },
    ],
    files: {},
  },
  {
    name: "regexp provider replacement",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "RegExp.prototype.test = () => true;\n",
    },
  },
  {
    name: "getter return member",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "return { submit, value: form.values.value };",
        after: "return { get submit() { return submit; }, value: form.values.value };",
      },
    ],
    files: {},
  },
  {
    name: "duplicate return member",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "return { submit, value: form.values.value };",
        after: "return { submit, submit, value: form.values.value };",
      },
    ],
    files: {},
  },
  {
    name: "computed projection",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: '{ ["submit"]: submit, value }',
      },
    ],
    files: {},
  },
  {
    name: "default projection",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: "{ submit = fallback, value }",
      },
    ],
    files: {},
  },
  {
    name: "rest projection",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: "{ submit, ...rest }",
      },
      {
        file: "view.tsx",
        before: "value={value}",
        after: "value={rest.value}",
      },
    ],
    files: {},
  },
  {
    name: "projected callback escape",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "  return <Form",
        after: "  unknown(submit);\n  return <Form",
      },
    ],
    files: {},
  },
  {
    name: "opaque event wrapper",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "onSubmit={submit}",
        after: "onSubmit={event => submit(event)}",
      },
    ],
    files: {},
  },
  {
    name: "returned pending alias disables submitter",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "return { submit, value: form.values.value };",
        after: "return { submit, value: form.values.value, pending: false };",
      },
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: "{ submit, value, pending: waiting }",
      },
      {
        file: "view.tsx",
        before: '<button type="submit">',
        after: '<button type="submit" disabled={waiting}>',
      },
    ],
    files: {},
  },
  {
    name: "opaque loading submit route",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: 'import { Form } from "./controls";',
        after: 'import { Form } from "./controls";\nimport { Action } from "./action";',
      },
      {
        file: "view.tsx",
        before: '<button type="submit">Send</button>',
        after: "<Action>Send</Action>",
      },
    ],
    files: {
      "action.tsx": "export const Action = unknownFactory();\n",
    },
  },
  {
    name: "ancestor disabling state",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "return <Form",
        after: "return <fieldset disabled={unknown}><Form",
      },
      {
        file: "view.tsx",
        before: "</Form>;",
        after: "</Form></fieldset>;",
      },
    ],
    files: {},
  },
  {
    name: "custom JSX transport",
    count: 0,
    edits: [],
    files: {
      "tsconfig.json": '{"compilerOptions":{"jsx":"react-jsx","jsxImportSource":"other-jsx"}}',
    },
  },
  {
    name: "modified React state provider",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after: "useState = replacement;\nexport const useDelivery",
      },
    ],
    files: {},
  },
  {
    name: "consumer unrelated same named setter does not replace owner",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before: "import { Form }",
        after: 'import { useState } from "react";\nimport { Form }',
      },
      {
        file: "view.tsx",
        before: "  const { submit, value }",
        after: "  const [, setForm] = useState(null);\n  void setForm;\n  const { submit, value }",
      },
    ],
    files: {},
  },
  {
    name: "direct native button click publication",
    count: 1,
    edits: [
      {
        file: "view.tsx",
        before:
          '<Form onSubmit={submit}><input value={value} readOnly /><button type="submit">Send</button></Form>',
        after: '<button type="button" onClick={submit}>Send</button>',
      },
    ],
    files: {},
  },
  {
    name: "unrelated lazy and dynamic router imports do not poison participants",
    count: 1,
    edits: [],
    files: {
      "router.tsx":
        'import React from "react";\nexport const Screen = React.lazy(() => import(`./screens/${route}`));\n',
    },
  },
  {
    name: "runtime parameter initializer provider poison",
    count: 0,
    edits: [],
    files: {
      "poison.ts":
        "class Installer { constructor(public prepared = (RegExp.prototype.test = () => true)) {} }\n",
    },
  },
  {
    name: "runtime enum initializer provider poison",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "enum Capability { changed = (RegExp.prototype.test = () => true) }\n",
    },
  },
  {
    name: "local Object validation gate is not canonical",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after:
          'let locked = false;\nconst Object = { values: () => { if (locked) return ["busy"]; locked = true; return []; } };\nexport const useDelivery',
      },
    ],
    files: {},
  },
  {
    name: "zero argument hook own action defaults block submission",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "useDelivery = (validate)",
        after: "useDelivery = ()",
      },
      {
        file: "delivery.tsx",
        before: "const values = form.values;\n    const issues = validate(values);",
        after: "const issues = {};",
      },
      {
        file: "view.tsx",
        before: "useDelivery(validate)",
        after: "useDelivery()",
      },
      {
        file: "view.tsx",
        before: 'import { Form } from "./controls";',
        after: 'import { Form } from "./controls";\nimport { Action } from "./action";',
      },
      {
        file: "view.tsx",
        before: '<button type="submit">Send</button>',
        after: "<Action>Send</Action>",
      },
    ],
    files: {
      "action.tsx":
        "export const Action = ({ children, onClick }) => <button onClick={onClick}>{children}</button>;\nAction.defaultProps = { onClick: event => event.preventDefault() };\n",
    },
  },
  {
    name: "only submitter is conditional on returned stage state",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "  const [form, setForm]",
        after: "  const [stage, setStage] = useState(false);\n  const [form, setForm]",
      },
      {
        file: "delivery.tsx",
        before: "    const values = form.values;\n    const issues = validate(values);",
        after:
          "    setStage(true);\n    const values = form.values;\n    const issues = validate(values);",
      },
      {
        file: "delivery.tsx",
        before: "return { submit, value: form.values.value };",
        after: "return { submit, value: form.values.value, stage };",
      },
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: "{ submit, value, stage }",
      },
      {
        file: "view.tsx",
        before: '<button type="submit">Send</button>',
        after: '<input /><input />{!stage && <button type="submit">Send</button>}',
      },
    ],
    files: {},
  },
  {
    name: "whole form is conditional on returned stage state",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "  const [form, setForm]",
        after: "  const [stage, setStage] = useState(false);\n  const [form, setForm]",
      },
      {
        file: "delivery.tsx",
        before: "    const values = form.values;\n    const issues = validate(values);",
        after:
          "    setStage(true);\n    const values = form.values;\n    const issues = validate(values);",
      },
      {
        file: "delivery.tsx",
        before: "return { submit, value: form.values.value };",
        after: "return { submit, value: form.values.value, stage };",
      },
      {
        file: "view.tsx",
        before: "{ submit, value }",
        after: "{ submit, value, stage }",
      },
      {
        file: "view.tsx",
        before: "return <Form",
        after: "return stage ? null : <Form",
      },
    ],
    files: {},
  },
  {
    name: "ancestor opaque submit callback",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "return <Form",
        after: "return <div onSubmit={opaque}><Form",
      },
      {
        file: "view.tsx",
        before: "</Form>;",
        after: "</Form></div>;",
      },
    ],
    files: {},
  },
  {
    name: "duplicate event publication declines",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: "onSubmit={submit}",
        after: "onSubmit={opaque} onSubmit={submit}",
      },
    ],
    files: {},
  },
  {
    name: "ready data validator plus preawait input overwrite is an interlock",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "setForm(previous => ({ ...previous, issues }));",
        after: "setForm(previous => ({ ...previous, values: { ready: false } }));",
      },
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: { ready: true }",
      },
    ],
    files: {
      "validator.ts":
        'export default fields => { const errors = {}; if (!fields.ready) errors.value = "Busy"; return errors; };\n',
    },
  },
  {
    name: "inline await option state write is pre-suspension work",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: '{ method: "POST" }',
        after:
          '{ method: "POST", body: (setForm(previous => ({ ...previous, values: { value: "blocked" } })), "") }',
      },
    ],
    files: {},
  },
  {
    name: "direct validated value mutation declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "    const issues = validate(values);",
        after: '    values.value = "blocked";\n    const issues = validate(values);',
      },
    ],
    files: {},
  },
  {
    name: "opaque synchronous helper under await operand declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: '{ method: "POST" }',
        after: '{ method: "POST", body: opaque(values) }',
      },
    ],
    files: {},
  },
  {
    name: "opaque nested render callback is not the consumer render path",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before:
          'return <Form onSubmit={submit}><input value={value} readOnly /><button type="submit">Send</button></Form>;',
        after:
          'return <Opaque>{() => <form onSubmit={submit}><button type="submit">Send</button></form>}</Opaque>;',
      },
    ],
    files: {},
  },
  {
    name: "saved JSX value outside final return is not publication",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before:
          'return <Form onSubmit={submit}><input value={value} readOnly /><button type="submit">Send</button></Form>;',
        after:
          'const view = <form onSubmit={submit}><button type="submit">Send</button></form>; void view; return null;',
      },
    ],
    files: {},
  },
  {
    name: "ordinary JSON request body is evaluated within Await",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: '{ method: "POST" }',
        after: '{ method: "POST", body: JSON.stringify(values) }',
      },
    ],
    files: {},
  },
  {
    name: "window JSON replacement is the same native provider",
    count: 0,
    edits: [],
    files: {
      "poison.ts": "window.JSON.stringify = replacement;\n",
    },
  },
  {
    name: "unknown pre-suspension callback gate declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "    const values = form.values;",
        after: "    if (unknownGate()) return;\n    const values = form.values;",
      },
    ],
    files: {},
  },
  {
    name: "plain initial data primitive leaves",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: 'values: { value: "ready", ready: true, count: -1, empty: null }',
      },
    ],
    files: {},
  },
  {
    name: "readonly primitive initial data alias",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: { value: initialValue }",
      },
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after: 'const initialValue = "ready";\nexport const useDelivery',
      },
    ],
    files: {},
  },
  {
    name: "readonly flat initial data record spread and alias",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: { ...initialAlias }",
      },
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after:
          'const initialValues = { value: "ready", ready: true };\nconst initialAlias = initialValues;\nexport const useDelivery',
      },
    ],
    files: {},
  },
  {
    name: "initial data getter can lock validation",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: 'values: { get value() { if (locked) return ""; locked = true; return "ready"; } }',
      },
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after: "let locked = false;\nexport const useDelivery",
      },
    ],
    files: {},
  },
  {
    name: "initial data toJSON method can lock request arguments",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after:
          'values: { value: "ready", toJSON() { this.value = ""; return { value: "ready" }; } }',
      },
      {
        file: "delivery.tsx",
        before: '{ method: "POST" }',
        after: '{ method: "POST", body: JSON.stringify(values) }',
      },
    ],
    files: {},
  },
  {
    name: "initial data function field is executable",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: 'values: { value: "ready", lock: () => true }',
      },
    ],
    files: {},
  },
  {
    name: "opaque initial data provider declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: acquireValues()",
      },
    ],
    files: {},
  },
  {
    name: "constructed initial data declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: new InitialValues()",
      },
    ],
    files: {},
  },
  {
    name: "initial data record alias mutation declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: { ...initialValues }",
      },
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after:
          'const initialValues = { value: "ready" };\ninitialValues.value = "blocked";\nexport const useDelivery',
      },
    ],
    files: {},
  },
  {
    name: "initial data record alias escape declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: { ...initialValues }",
      },
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after:
          'const initialValues = { value: "ready" };\nconfigure(initialValues);\nexport const useDelivery',
      },
    ],
    files: {},
  },
  {
    name: "submitter explicit foreign form owner declines",
    count: 0,
    edits: [
      {
        file: "view.tsx",
        before: '<button type="submit">',
        after: '<button form="other" type="submit">',
      },
    ],
    files: {},
  },
  {
    name: "primitive ready field validation stays visible",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: 'values: { value: "ready" }',
        after: "values: { ready: true }",
      },
    ],
    files: {
      "validator.ts":
        'export default fields => { const errors = {}; if (!fields.ready) errors.value = "Busy"; return errors; };\n',
    },
  },
  {
    name: "transparent casts around pre-suspension call receivers",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: "event.preventDefault()",
        after: "(event as any).preventDefault()",
      },
      {
        file: "delivery.tsx",
        before: 'Object.values(issues).every(error => error === "")',
        after: '((Object as any).values(issues) as any).every(error => error === "")',
      },
      {
        file: "delivery.tsx",
        before: '{ method: "POST" }',
        after: '{ method: "POST", body: (JSON as any).stringify(values) }',
      },
    ],
    files: {},
  },
  {
    name: "transparent nonnull around pre-suspension call receivers",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: "event.preventDefault()",
        after: "(event!).preventDefault()",
      },
      {
        file: "delivery.tsx",
        before: 'Object.values(issues).every(error => error === "")',
        after: '((Object!).values(issues)!).every(error => error === "")',
      },
      {
        file: "delivery.tsx",
        before: '{ method: "POST" }',
        after: '{ method: "POST", body: (JSON!).stringify(values) }',
      },
    ],
    files: {},
  },
  {
    name: "single-return blocks preserve updater and validation gate",
    count: 1,
    edits: [
      {
        file: "delivery.tsx",
        before: "previous => ({ ...previous, issues })",
        after: "previous => { return (({ ...previous, issues })); }",
      },
      {
        file: "delivery.tsx",
        before: 'error => error === ""',
        after: 'error => { return (error === ""); }',
      },
    ],
    files: {},
  },
  {
    name: "validation gate block with an extra effect declines",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: 'error => error === ""',
        after: 'error => { lock(); return error === ""; }',
      },
    ],
    files: {},
  },
  {
    name: "transparent casts preserve validator parameter and error fields",
    count: 1,
    edits: [
      {
        file: "validator.ts",
        before: "fields.value",
        after: "(fields as any).value",
      },
      {
        file: "validator.ts",
        before: "errors.value",
        after: "(errors!).value",
      },
      {
        file: "delivery.tsx",
        before: "form.values",
        after: "(form as any).values",
      },
    ],
    files: {},
  },
  {
    name: "transparent Object receiver does not permit a shadow provider",
    count: 0,
    edits: [
      {
        file: "delivery.tsx",
        before: "export const useDelivery",
        after: "const Object = { values: () => [] };\nexport const useDelivery",
      },
      {
        file: "delivery.tsx",
        before: "Object.values(issues)",
        after: "(Object as any).values(issues)",
      },
    ],
    files: {},
  },
  {
    name: "transparent validator receiver still refuses captured locking",
    count: 0,
    edits: [],
    files: {
      "validator.ts":
        'let locked = false;\nexport default fields => { const errors = {}; if (locked) errors.value = "Busy"; locked = true; if (!(fields as any).value) errors.value = "Required"; return errors; };\n',
    },
  },
];

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-own-hook-submit-"));
const ownerFilename = path.join(directory, "delivery.tsx");
const consumerFilename = path.join(directory, "view.tsx");
beforeEach(() => {
  for (const name of fs.readdirSync(directory))
    fs.rmSync(path.join(directory, name), { recursive: true, force: true });
  for (const [name, body] of Object.entries(BASE_FILES))
    fs.writeFileSync(path.join(directory, name), body);
  resetFilesystemCaches();
});
afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("owned Hook async handler publication", () => {
  for (const fixture of cases)
    it(fixture.name, () => {
      const files: Record<string, string> = { ...BASE_FILES, ...fixture.files };
      for (const edit of fixture.edits) {
        expect(files[edit.file]).toContain(edit.before);
        files[edit.file] = files[edit.file].replaceAll(edit.before, edit.after);
      }
      for (const [name, body] of Object.entries(files))
        fs.writeFileSync(path.join(directory, name), body);
      resetFilesystemCaches();
      const owner = runRule(noAsyncEventHandlerWithoutReentryGuard, files["delivery.tsx"], {
        filename: ownerFilename,
      });
      expect(owner.parseErrors).toEqual([]);
      expect(owner.diagnostics).toHaveLength(fixture.count);
      const consumer = runRule(noAsyncEventHandlerWithoutReentryGuard, files["view.tsx"], {
        filename: consumerFilename,
      });
      expect(consumer.parseErrors).toEqual([]);
      expect(consumer.diagnostics).toEqual([]);
    });

  it("does not index consumers for a harmless returned async callback", () => {
    const source = BASE_FILES["delivery.tsx"].replace(
      'if (response.ok) setForm({ values: { value: "" }, issues: {} });',
      "if (response.ok) void response;",
    );
    fs.writeFileSync(ownerFilename, source);
    const result = captureCrossFileProbes(() =>
      runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename: ownerFilename }),
    );
    expect(result.value.parseErrors).toEqual([]);
    expect(result.value.diagnostics).toEqual([]);
    expect(result.trace.contentPaths.has(consumerFilename)).toBe(false);
  });

  it("reports once in the owner with Unicode before the Await", () => {
    const source = 'const marker = "λ🔒"; void marker;\n' + BASE_FILES["delivery.tsx"];
    fs.writeFileSync(ownerFilename, source);
    const captured: CapturedHookReport[] = [];
    const result = runRule(
      {
        ...noAsyncEventHandlerWithoutReentryGuard,
        create: (context) => {
          const create = noAsyncEventHandlerWithoutReentryGuard.create;
          if (!create) throw new Error("Expected AST rule");
          return create({
            ...context,
            report: (descriptor) => {
              captured.push({
                filename: context.filename,
                node: descriptor.node,
                program: context.scopes.rootScope.node,
              });
              context.report(descriptor);
            },
          });
        },
      },
      source,
      { filename: ownerFilename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(captured).toHaveLength(1);
    const report = captured[0];
    expect(report.filename).toBe(ownerFilename);
    expect(findProgramRoot(report.node)).toBe(report.program);
    expect(report.node.type).toBe("AwaitExpression");
    const offset = getNodeStartIndex(report.node);
    expect(offset).toBe(source.indexOf("await fetch"));
    if (offset === null) throw new Error("Missing Await location");
    expect(Buffer.byteLength(source.slice(0, offset))).toBe(
      Buffer.from(source).indexOf(Buffer.from("await fetch")),
    );
    expect(Buffer.byteLength(source.slice(0, offset))).toBeGreaterThan(offset);
  });

  it("several consumers do not duplicate the owner warning", () => {
    fs.writeFileSync(
      path.join(directory, "second-view.tsx"),
      BASE_FILES["view.tsx"].replace("Panel", "OtherPanel"),
    );
    resetFilesystemCaches();
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["delivery.tsx"], {
      filename: ownerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("refreshes warm consumer and provider edits across filesystem epochs", () => {
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["delivery.tsx"], {
        filename: ownerFilename,
      }).diagnostics,
    ).toHaveLength(1);
    fs.writeFileSync(consumerFilename, BASE_FILES["view.tsx"].replace("onSubmit={submit}", ""));
    resetFilesystemCaches();
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["delivery.tsx"], {
        filename: ownerFilename,
      }).diagnostics,
    ).toEqual([]);
    fs.writeFileSync(consumerFilename, BASE_FILES["view.tsx"]);
    resetFilesystemCaches();
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["delivery.tsx"], {
        filename: ownerFilename,
      }).diagnostics,
    ).toHaveLength(1);
    fs.writeFileSync(path.join(directory, "poison.ts"), "RegExp.prototype.test = () => true;");
    resetFilesystemCaches();
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["delivery.tsx"], {
        filename: ownerFilename,
      }).diagnostics,
    ).toEqual([]);
    fs.rmSync(path.join(directory, "poison.ts"));
    resetFilesystemCaches();
    expect(
      runRule(noAsyncEventHandlerWithoutReentryGuard, BASE_FILES["delivery.tsx"], {
        filename: ownerFilename,
      }).diagnostics,
    ).toHaveLength(1);
  });
});
