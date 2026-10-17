// rule: no-ref-callback-cleanup-before-react-19
// weakness: callback-local-map-snapshot-null-detach
// source: independently-synthetic
// verdict: pass
import * as React from "react";
export const EntryPanel = () => {
  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());
  const entryKey = "card";

  return (
    <li
      ref={(element) => {
        const snapshot = entries.current;
        if (element) snapshot.set(entryKey, element);
        else snapshot.delete(entryKey);
        return () => {
          snapshot.delete(entryKey);
        };
      }}
    >
      Entry
    </li>
  );
};
