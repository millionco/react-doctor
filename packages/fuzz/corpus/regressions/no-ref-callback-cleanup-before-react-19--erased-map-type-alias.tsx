// rule: no-ref-callback-cleanup-before-react-19
// verdict: pass
// weakness: alias-guard
// source: independently-synthetic callback Map proof review
type Map = {};
import * as React from "react";
export const EntryPanel = () => {
  const entries = React.useRef(new Map());
  const item = { id: "first" };

  return (
    <li
      ref={(element) => {
        const snapshot = entries.current;
        if (element) snapshot.set(item.id, element);
        else snapshot.delete(item.id);
        return () => {
          snapshot.delete(item.id);
        };
      }}
    >
      Entry
    </li>
  );
};
