// rule: hook-use-state
// verdict: pass
// weakness: dynamic-computed
// source: synthetic retained value with ordinary data operations
import { useState } from "react";

export const RetainedLabel = ({ initialLabel, records, selectedKey }) => {
  const [label] = useState(initialLabel);
  const recordKeys = Object.keys(records);
  const selectedRecord = records[selectedKey];
  const { [selectedKey]: removedRecord, ...remainingRecords } = records;
  return (
    <section title={label}>
      {recordKeys.length}:{selectedRecord.title}:{removedRecord.title}:
      {Object.keys(remainingRecords).length}
    </section>
  );
};
