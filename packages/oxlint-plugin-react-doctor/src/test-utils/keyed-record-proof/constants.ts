export const KEYED_RECORD_PROOF_COUNTS = [20, 100];
export const KEYED_RECORD_PROOF_DISTINCT_SHAPE = "distinct-parent-child-pairs";
export const KEYED_RECORD_PROOF_SHARED_SHAPE = "single-child-many-callers";
export const KEYED_RECORD_PROOF_AST_READS_PER_CODE_UNIT = 8;
export const KEYED_RECORD_PROOF_REFERENCE_READS_PER_ENTRY = 20;
export const KEYED_RECORD_PROOF_PROVIDER_READS_PER_ENTRY = 6;
export const KEYED_RECORD_PROOF_ROOT_READS_PER_ENTRY = 4;
export const KEYED_RECORD_PROOF_READ_PADDING = 10;
export const KEYED_RECORD_PROOF_MAX_PROGRAM_BODY_READS = 8;
export const KEYED_RECORD_PROOF_KEY_ATTRIBUTE = " key={record.requestId ?? record.id}";
export const KEYED_RECORD_PROOF_SETTINGS = {
  "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] },
};
export const KEYED_RECORD_PROOF_PREACT_SETTINGS = {
  "react-doctor": { portedRuleMode: "curated", capabilities: ["preact"] },
};
export const KEYED_RECORD_PROOF_REACT_DIRECTIVE = "/* @jsxImportSource react */\n";
export const KEYED_RECORD_PROOF_PREACT_DIRECTIVE = "/* @jsxImportSource preact */\n";
export const KEYED_RECORD_PROOF_SOURCE = `import { useEffect, useState } from "react";
interface RowData { id: string; requestId?: string | null; label?: string }
export const Parent = ({ record }: { record: RowData }) => <PrivateCard key={record.requestId ?? record.id} record={record} />;
function PrivateCard({ record }: { record: RowData }) {
  const { label } = record;
  const recordKey = record.requestId ?? record.id;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReady(false); setError(null); }, [recordKey]);
  return <button onClick={() => { setReady(true); setError("edited"); }}>{label ?? (ready ? error : "idle")}</button>;
}
`;

export const KEYED_RECORD_PROOF_CONTEXT_COMPONENT_COUNT = 2;
