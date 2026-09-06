// rule: no-derived-state
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: fail

import { useEffect, useState } from "react";

interface Entry {
  label: string;
}

export const CopiedEntries = ({ entries }: { entries: Entry[] }) => {
  const [visibleEntries, setVisibleEntries] = useState<Entry[]>([]);
  useEffect(() => {
    setVisibleEntries(entries as Entry[]);
  }, [entries]);
  return <span>{visibleEntries.length}</span>;
};
