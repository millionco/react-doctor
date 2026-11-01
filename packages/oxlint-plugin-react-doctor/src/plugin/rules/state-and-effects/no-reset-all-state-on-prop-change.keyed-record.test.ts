import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

interface KeyedRecordResetCase {
  name: string;
  code: string;
  filename: string;
  expectedCount: number;
}

const cases: ReadonlyArray<KeyedRecordResetCase> = [
  {
    name: "runtime-string-snapshot-direct-transport",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: unknown }) => { if (typeof value !== "string") return null; return <PrivateCard key={value} identity={value} />; };\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/runtime-string-snapshot-direct-transport.tsx",
    expectedCount: 1,
  },
  {
    name: "typed-nullish-record-separate-rereads",
    code: 'import { useEffect, useState } from "react";\ninterface RecordData { id: string; requestId?: string | null }\nexport const Parent = ({ record }: { record: RecordData }) => <PrivateCard key={record.requestId ?? record.id} identity={record.requestId ?? record.id} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/typed-nullish-record-separate-rereads.tsx",
    expectedCount: 1,
  },
  {
    name: "number-string-key-collision",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: string | number }) => <PrivateCard key={value} identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/number-string-key-collision.tsx",
    expectedCount: 1,
  },
  {
    name: "positive-negative-zero-key-collision",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: number }) => <PrivateCard key={value} identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/positive-negative-zero-key-collision.tsx",
    expectedCount: 1,
  },
  {
    name: "record-getter-changes-between-reads",
    code: 'import { useEffect, useState } from "react";\nlet reads = 0; const record = { get id() { reads += 1; return reads % 2 === 0 ? "child" : "parent"; } };\nexport const Parent = () => <PrivateCard key={record.id} identity={record.id} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/record-getter-changes-between-reads.tsx",
    expectedCount: 1,
  },
  {
    name: "visible-record-write-between-key-and-prop",
    code: 'import { useEffect, useState } from "react";\nconst touch = (record: { id: string }) => { record.id = "changed"; return false; };\nexport const Parent = ({ record }: { record: { id: string } }) => <PrivateCard key={record.id} unused={touch(record)} identity={record.id} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/visible-record-write-between-key-and-prop.tsx",
    expectedCount: 1,
  },
  {
    name: "later-spread-may-override-dependency",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value, rest }: { value: string; rest: { identity: string } }) => <PrivateCard key={value} identity={value} {...rest} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/later-spread-may-override-dependency.tsx",
    expectedCount: 1,
  },
  {
    name: "second-unkeyed-use",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: string }) => <><PrivateCard key={value} identity={value} /><PrivateCard identity={value} /></>;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/second-unkeyed-use.tsx",
    expectedCount: 1,
  },
  {
    name: "component-value-escapes",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: string }) => <PrivateCard key={value} identity={value} />;\nexport { PrivateCard };\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/component-value-escapes.tsx",
    expectedCount: 1,
  },
  {
    name: "alias-component-unkeyed",
    code: 'import { useEffect, useState } from "react";\nconst Alias = PrivateCard;\nexport const Parent = ({ value }: { value: string }) => <Alias identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/alias-component-unkeyed.tsx",
    expectedCount: 1,
  },
  {
    name: "different-key-discriminator",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value, other }: { value: string; other: string }) => <PrivateCard key={other} identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/different-key-discriminator.tsx",
    expectedCount: 1,
  },
  {
    name: "constant-key",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: string }) => <PrivateCard key="fixed" identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/constant-key.tsx",
    expectedCount: 1,
  },
  {
    name: "coercible-object-key-collision",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: { toString: () => string } }) => <PrivateCard key={value as never} identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/coercible-object-key-collision.tsx",
    expectedCount: 1,
  },
  {
    name: "erased-string-assertion-is-not-runtime-guard",
    code: 'import { useEffect, useState } from "react";\nexport const Parent = ({ value }: { value: unknown }) => <PrivateCard key={value as string} identity={value} />;\nfunction PrivateCard({ identity }: { identity: unknown }) {\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [identity]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{ready ? error : "idle"}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/erased-string-assertion-is-not-runtime-guard.tsx",
    expectedCount: 1,
  },
  {
    name: "typed-immutable-record-original-fit",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename:
      "/synthetic/keyed-private-component/selected-b-typed-immutable-record-original-fit.tsx",
    expectedCount: 0,
  },
  {
    name: "renamed-record-and-fields",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { stableKey: string; pendingKey?: string | null; label?: string }\nexport const Parent = ({ item }: { item: RowData }) => <PrivateCard key={item.pendingKey ?? item.stableKey} item={item} />;\nfunction PrivateCard({ item }: { item: RowData }) {\n  const { label } = item;\n  const itemKey = item.pendingKey ?? item.stableKey;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [itemKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-renamed-record-and-fields.tsx",
    expectedCount: 0,
  },
  {
    name: "all-two-calls-keyed-correctly",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <><PrivateCard key={record.requestId ?? record.id} record={record} /><PrivateCard key={record.requestId ?? record.id} record={record} /></>;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-all-two-calls-keyed-correctly.tsx",
    expectedCount: 0,
  },
  {
    name: "direct-pair-dependency",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [record.requestId ?? record.id]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-direct-pair-dependency.tsx",
    expectedCount: 0,
  },
  {
    name: "fallback-number-string-union",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string | number; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-fallback-number-string-union.tsx",
    expectedCount: 1,
  },
  {
    name: "nullable-fallback-field",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string | null; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-nullable-fallback-field.tsx",
    expectedCount: 1,
  },
  {
    name: "visible-getter-record-producer",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n\nlet reads = 0; const accessorRecord: RowData = { get id() { reads += 1; return String(reads); } }; export const AccessorApp = () => <Parent record={accessorRecord} />;\n',
    filename: "/synthetic/keyed-private-component/selected-b-visible-getter-record-producer.tsx",
    expectedCount: 1,
  },
  {
    name: "selected-record-write",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  record.id = "changed";\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-selected-record-write.tsx",
    expectedCount: 1,
  },
  {
    name: "record-escape-through-call",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  consumeRecord(record);\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-record-escape-through-call.tsx",
    expectedCount: 1,
  },
  {
    name: "parent-record-const-alias",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => { const copy = record; return <PrivateCard key={record.requestId ?? record.id} record={copy} />; };\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-parent-record-const-alias.tsx",
    expectedCount: 1,
  },
  {
    name: "second-unkeyed-record-call",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <><PrivateCard key={record.requestId ?? record.id} record={record} /><PrivateCard record={record} /></>;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-second-unkeyed-record-call.tsx",
    expectedCount: 1,
  },
  {
    name: "spread-may-replace-record",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record, rest }: { record: RowData; rest: { record: RowData } }) => <PrivateCard key={record.requestId ?? record.id} record={record} {...rest} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-spread-may-replace-record.tsx",
    expectedCount: 1,
  },
  {
    name: "extra-effect-dependency",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey, label]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-extra-effect-dependency.tsx",
    expectedCount: 1,
  },
  {
    name: "merged-local-interface",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\ninterface RowData { extra?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-merged-local-interface.tsx",
    expectedCount: 1,
  },
  {
    name: "generic-record-interface",
    code: 'import { useEffect, useState } from "react";\ninterface RowData<Scalar = string> { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-generic-record-interface.tsx",
    expectedCount: 1,
  },
  {
    name: "mutable-dependency-alias",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  let recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-mutable-dependency-alias.tsx",
    expectedCount: 1,
  },
  {
    name: "swapped-nullish-dependency",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.id ?? record.requestId;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-swapped-nullish-dependency.tsx",
    expectedCount: 1,
  },
  {
    name: "component-alias-transport",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nconst Alias = PrivateCard;\nexport const Parent = ({ record }: { record: RowData }) => <Alias key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-component-alias-transport.tsx",
    expectedCount: 1,
  },
  {
    name: "duplicate-key-attribute",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key="fixed" key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-duplicate-key-attribute.tsx",
    expectedCount: 1,
  },
  {
    name: "type-alias-not-selected-interface",
    code: 'import { useEffect, useState } from "react";\ntype RowData = { id: string; requestId?: string | null; label?: string };\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-type-alias-not-selected-interface.tsx",
    expectedCount: 1,
  },
  {
    name: "eval-shaped-record-admission",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  eval("void 0");\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-eval-shaped-record-admission.tsx",
    expectedCount: 0,
  },
  {
    name: "different-record-prop",
    code: 'import { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record, other }: { record: RowData; other: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={other} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename: "/synthetic/keyed-private-component/selected-b-different-record-prop.tsx",
    expectedCount: 1,
  },
  {
    name: "whole-type-only-react-hooks-used-as-runtime",
    code: 'import type { useEffect, useState } from "react";\nimport { useCallback } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename:
      "/synthetic/keyed-private-component/selected-b-whole-type-only-react-hooks-used-as-runtime.tsx",
    expectedCount: 1,
  },
  {
    name: "inline-type-only-react-hooks-used-as-runtime",
    code: 'import { type useEffect, type useState, useCallback } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename:
      "/synthetic/keyed-private-component/selected-b-inline-type-only-react-hooks-used-as-runtime.tsx",
    expectedCount: 1,
  },
  {
    name: "valid-extra-type-only-react-node-with-value-hooks",
    code: 'import { useEffect, useState, type ReactNode } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; node?: ReactNode }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename:
      "/synthetic/keyed-private-component/selected-b-valid-extra-type-only-react-node-with-value-hooks.tsx",
    expectedCount: 0,
  },
  {
    name: "non-react-type-import-reexport-with-native-value-hooks",
    code: 'import type { RecordMetadata } from "./record-metadata";\nexport type { RecordMetadata } from "./record-metadata";\nimport { useEffect, useState } from "react";\ninterface RowData { id: string; requestId?: string | null; label?: string; metadata?: RecordMetadata }\nexport const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;\nfunction PrivateCard({ record }: { record: RowData }) {\n  const { label } = record;\n  const recordKey = record.requestId ?? record.id;\n  const [ready, setReady] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => { setReady(false); setError(null); }, [recordKey]);\n  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;\n}\n',
    filename:
      "/synthetic/keyed-private-component/selected-b-non-react-type-import-reexport-with-native-value-hooks.tsx",
    expectedCount: 0,
  },
];

const settings = { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } };

describe("no-reset-all-state-on-prop-change keyed immutable record", () => {
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
