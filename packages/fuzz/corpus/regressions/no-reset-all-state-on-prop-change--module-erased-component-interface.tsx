// rule: no-reset-all-state-on-prop-change
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";
interface RowData {
  id: string;
  requestId?: string | null;
  label?: string;
}
export const Parent = ({ record }: { record: RowData }) => (
  <PrivateCard key={record.requestId ?? record.id} record={record} />
);
function PrivateCard({ record }: { record: RowData }) {
  const { label } = record;
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

interface PrivateCard {}
