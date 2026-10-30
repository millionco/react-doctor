// rule: no-reset-all-state-on-prop-change
// weakness: framework-gating
// source: synthetic
// verdict: fail
/** @jsxRuntime classic */
/** @jsx jsxFactory */
import { createElement, useEffect, useState } from "react";
const jsxFactory = (component, props, ...children) =>
  createElement(component, { ...props, key: "fixed" }, ...children);
interface RowData {
  id: string;
  requestId?: string | null;
  label?: string;
}
export const Parent = ({ record }: { record: RowData }) => (
  <PrivateCard key={record.requestId ?? record.id} record={record} />
);
const PrivateCard = ({ record }: { record: RowData }) => {
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
};
