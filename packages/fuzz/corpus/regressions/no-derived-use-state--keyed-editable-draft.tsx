// rule: no-derived-useState
// verdict: pass
// weakness: copy-tracking
// source: synthetic
import { useState } from "react";

interface RecordDraft {
  slug: string;
  label: string;
}

const Editor = ({ record }: { record: RecordDraft }) => {
  const [label, setLabel] = useState(record.label);
  return <input value={label} onChange={(event) => setLabel(event.target.value)} />;
};

export const Screen = ({ record }: { record: RecordDraft }) => (
  <Editor key={record.slug} record={record} />
);
