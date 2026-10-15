// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// source: synthetic independent effect payload
// verdict: pass
import { useEffect, useState } from "react";

interface RecordHandle {
  refresh: () => void;
}

interface ResourceProps {
  createRecord: () => RecordHandle;
}

export const ResourceBridge = ({ createRecord }: ResourceProps) => {
  const [activeRecord, setActiveRecord] = useState<RecordHandle | null>(null);
  useEffect(() => {
    if (activeRecord === null) setActiveRecord(createRecord());
  }, [activeRecord, createRecord]);
  useEffect(() => {
    if (activeRecord !== null) activeRecord.refresh();
  }, [activeRecord]);
  return <section />;
};
