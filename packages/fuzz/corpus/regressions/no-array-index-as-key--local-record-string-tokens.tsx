// rule: no-array-index-as-key
// weakness: copy-tracking
// verdict: pass
import { useCallback } from "react";

export const TokenLabels = () => {
  const getRecords = useCallback(() => {
    const records = [{ id: "first", text: "A A" }];
    return records;
  }, []);
  const records = getRecords();
  const visibleRecords = records.filter((record) => record.id.length > 0);
  return visibleRecords.map((record) => (
    <div key={record.id}>
      {record.text.split(" ").map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </div>
  ));
};
