// rule: no-ref-callback-cleanup-before-react-19
// weakness: guarded-return-null-detach
// source: independently-synthetic
// verdict: fail
import * as React from "react";

export const EntryPanel = () => {
  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());
  const entryKey = "entry";

  return (
    <li
      ref={(element) => {
        if (element) {
          entries.current.set(entryKey, element);
          return () => {
            if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);
          };
        } else {
          void element;
        }
      }}
    >
      Entry
    </li>
  );
};
