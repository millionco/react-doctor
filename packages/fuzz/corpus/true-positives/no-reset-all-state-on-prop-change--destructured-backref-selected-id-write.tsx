// rule: no-reset-all-state-on-prop-change
// weakness: alias-guard
// source: synthetic
// verdict: fail
import { useEffect, useState } from "react";
interface RowData {
  id: string;
  requestId?: string | null;
  label?: string;
  backref?: RowData;
}
export const Parent = ({ record }: { record: RowData }) => (
  <PrivateCard key={record.requestId ?? record.id} record={record} />
);
function PrivateCard({ record }: { record: RowData }) {
  const { label, backref } = record;
  if (backref) backref.id = label ?? "fixed";
  const recordKey = record.requestId ?? record.id;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReady(false);
    setError(null);
  }, [recordKey]);
  return (
    <button
      onClick={() => {
        setReady(true);
        setError("edited");
      }}
    >
      {label ?? (ready ? error : "idle")}
    </button>
  );
}

const sourceRecord: RowData = { id: "fixed", label: "fixed" };
sourceRecord.backref = sourceRecord;
export const App = () => <Parent record={sourceRecord} />;
export const advanceLabel = () => {
  sourceRecord.label = "next";
};
