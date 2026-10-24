// rule: hook-use-state
// verdict: pass
// weakness: library-idiom
// source: synthetic retained container with dynamic record access
import { useState } from "react";

export const RetainedRegistry = ({ records, selectedKey }) => {
  const [cache] = useState(() => new Map());
  cache.set(selectedKey, records[selectedKey]);
  return <section>{cache.size}</section>;
};
