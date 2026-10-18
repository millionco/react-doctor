import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

interface KeyedRecordBoundaryCase {
  name: string;
  filename: string;
  code: string;
  expectedCount: number;
}

const cases: ReadonlyArray<KeyedRecordBoundaryCase> = [
  {
    name: "destructured-backref-readonly-primitive-label-jsx",
    filename:
      "/synthetic/2119-nested-alias-review/destructured-backref-readonly-primitive-label-jsx.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  if (backref) return <button onClick={() => { setReady(true); setError("edited"); }}>{backref.label ?? (ready ? error : "idle")}</button>;\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 0,
  },
  {
    name: "void-return-object-alias-argument-escape",
    filename: "/synthetic/2119-void-alias-review/void-return-object-alias-argument-escape.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: void }\nconst capture: (value: RowData) => void = value => value;\nconst consume = (value: unknown, nextId: string) => {\n  if (typeof value === "object" && value !== null && "id" in value) value.id = nextId;\n};\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  consume(backref, label ?? "fixed");\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = capture(sourceRecord);\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "void-return-object-alias-discard-control",
    filename: "/synthetic/2119-void-alias-review/void-return-object-alias-discard-control.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: void }\nconst capture: (value: RowData) => void = value => value;\nconst consume = (value: unknown, nextId: string) => {\n  if (typeof value === "object" && value !== null && "id" in value) value.id = nextId;\n};\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  void backref;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = capture(sourceRecord);\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 0,
  },
  {
    name: "classic-default-unbound-react-control",
    filename: "/synthetic/2119-classic-default/classic-default-unbound-react-control.tsx",
    code: '/** @jsxRuntime classic */\nimport { useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "classic-default-react-parameter-overrides-key",
    filename: "/synthetic/2119-classic-default/classic-default-react-parameter-overrides-key.tsx",
    code: '/** @jsxRuntime classic */\nimport { useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record, React }: { record: RowData; React: { createElement: typeof import("react").createElement } }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 1,
  },
  {
    name: "readonly-numeric-label-jsx",
    filename: "/synthetic/keyed-record-numeric-label.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: number }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 0,
  },
  {
    name: "nominal",
    filename: "/synthetic/upper-keyed-record/00-nominal.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 0,
  },
  {
    name: "module-erased-use-effect-interface",
    filename: "/synthetic/upper-keyed-record/01-module-erased-use-effect-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface useEffect {}\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 0,
  },
  {
    name: "module-erased-use-state-type",
    filename: "/synthetic/upper-keyed-record/02-module-erased-use-state-type.tsx",
    code: 'import { useEffect, useState } from "react";\ntype useState = { readonly marker?: true };\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 0,
  },
  {
    name: "component-erased-record-interface",
    filename: "/synthetic/upper-keyed-record/03-component-erased-record-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  interface record {}\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 0,
  },
  {
    name: "component-erased-record-key-interface",
    filename: "/synthetic/upper-keyed-record/04-component-erased-record-key-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  interface recordKey {}\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 0,
  },
  {
    name: "module-erased-component-interface",
    filename: "/synthetic/upper-keyed-record/05-module-erased-component-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\ninterface PrivateCard {}\n',
    expectedCount: 0,
  },
  {
    name: "unrelated-erased-interface-control",
    filename: "/synthetic/upper-keyed-record/06-unrelated-erased-interface-control.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\ninterface UnrelatedMarker { label?: string }\n',
    expectedCount: 0,
  },
  {
    name: "type-only-runtime-hook-decline",
    filename: "/synthetic/upper-keyed-record/07-type-only-runtime-hook-decline.tsx",
    code: 'import type { useEffect, useState } from "react";\nimport { useCallback } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 1,
  },
  {
    name: "named-hook-value-escape-decline",
    filename: "/synthetic/upper-keyed-record/08-named-hook-value-escape-decline.tsx",
    code: 'import { useEffect, useState } from "react";\nconst escapedEffect = useEffect;\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 1,
  },
  {
    name: "named-hook-property-write-decline",
    filename: "/synthetic/upper-keyed-record/09-named-hook-property-write-decline.tsx",
    code: 'import { useEffect, useState } from "react";\nuseEffect.hidden = true;\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    expectedCount: 1,
  },
  {
    name: "destructured-backref-selected-id-write",
    filename: "/synthetic/2119-alias-review/destructured-backref-selected-id-write.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) backref.id = label ?? "fixed";\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "destructured-backref-read-only-control",
    filename: "/synthetic/2119-alias-review/destructured-backref-read-only-control.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) void backref.id;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 0,
  },
  {
    name: "nominal-ordinary-react",
    filename: "/synthetic/keyed-record-provider/nominal-ordinary-react.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "unused-key-overriding-factory",
    filename: "/synthetic/keyed-record-provider/unused-key-overriding-factory.tsx",
    code: 'import { createElement, useEffect, useState } from "react";\nconst jsxFactory = (component, props, ...children) => createElement(component, { ...props, key: "fixed" }, ...children);\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "inert-jsx-marker-string",
    filename: "/synthetic/keyed-record-provider/inert-jsx-marker-string.tsx",
    code: 'import { createElement, useEffect, useState } from "react";\nconst jsxFactory = (component, props, ...children) => createElement(component, { ...props, key: "fixed" }, ...children);\nconst pragmaMarker = "@jsx jsxFactory";\nvoid pragmaMarker;\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "actual-classic-jsx-pragma-overrides-key",
    filename: "/synthetic/keyed-record-provider/actual-classic-jsx-pragma-overrides-key.tsx",
    code: '/** @jsxRuntime classic */\n/** @jsx jsxFactory */\nimport { createElement, useEffect, useState } from "react";\nconst jsxFactory = (component, props, ...children) => createElement(component, { ...props, key: "fixed" }, ...children);\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 1,
  },
  {
    name: "standalone-classic-react-runtime",
    filename: "/synthetic/keyed-record-provider/standalone-classic-react-runtime.tsx",
    code: '/** @jsxRuntime classic */\nimport { useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "named-react-create-element-factory",
    filename: "/synthetic/keyed-record-provider/named-react-create-element-factory.tsx",
    code: '/** @jsxRuntime classic */\n/** @jsx createElement */\nimport { createElement, useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "unshadowed-imported-factory-control",
    filename: "/synthetic/2119-pragma-shadow/unshadowed-imported-factory-control.tsx",
    code: '/** @jsxRuntime classic */\n/** @jsx createElement */\nimport { createElement, useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record }: { record: RowData }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 0,
  },
  {
    name: "selected-parent-parameter-shadows-jsx-factory",
    filename: "/synthetic/2119-pragma-shadow/selected-parent-parameter-shadows-jsx-factory.tsx",
    code: '/** @jsxRuntime classic */\n/** @jsx createElement */\nimport { createElement, useEffect, useState } from "react";\ninterface RowData {\n  id: string;\n  requestId?: string | null;\n  label?: string;\n}\nexport const Parent = ({ record, createElement }: { record: RowData; createElement: typeof import("react").createElement }) => (\n  <PrivateCard key={record.requestId ?? record.id} record={record} />\n);\nconst PrivateCard = ({ record }: { record: RowData }) => {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    setReady(false);\n    setError(null);\n  }, [recordKey]);\n  return (\n    <button\n      onClick={() => {\n        setReady(true);\n        setError("edited");\n      }}\n    >\n      {label ?? (ready ? error : "idle")}\n    </button>\n  );\n};\n',
    expectedCount: 1,
  },
  {
    name: "destructured-member-receiver-call",
    filename: "/synthetic/keyed-record-alias/member-receiver-call.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) backref.toString();\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "destructured-wrapped-member-write",
    filename: "/synthetic/keyed-record-alias/wrapped-member-write.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) (backref as RowData).id = "changed";\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "destructured-member-update",
    filename: "/synthetic/keyed-record-alias/member-update.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) backref.id++;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "destructured-member-delete",
    filename: "/synthetic/keyed-record-alias/member-delete.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) delete backref.id;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "destructured-argument-escape",
    filename: "/synthetic/keyed-record-alias/argument-escape.tsx",
    code: 'declare const consumeBackref: (value: RowData) => void;\nimport { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) consumeBackref(backref);\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
  {
    name: "destructured-variable-alias-escape",
    filename: "/synthetic/keyed-record-alias/variable-alias-escape.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; backref?: RowData }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label, backref } = record;\n  if (backref) { const escaped = backref; escaped.id = "changed"; }\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nconst sourceRecord: RowData = { id: "fixed", label: "fixed" };\nsourceRecord.backref = sourceRecord;\nexport const App = () => <Parent record={sourceRecord} />;\nexport const advanceLabel = () => { sourceRecord.label = "next"; };\n',
    expectedCount: 1,
  },
];

const settings = { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } };

describe("no-reset-all-state-on-prop-change keyed record boundaries", () => {
  it.each(cases)("$name", ({ code, filename, expectedCount }) => {
    const result = runRule(noResetAllStateOnPropChange, code, {
      filename,
      settings,
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
