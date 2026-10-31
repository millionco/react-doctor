// rule: no-ref-callback-cleanup-before-react-19
// weakness: callback-ownership
// source: independently-synthetic
// verdict: fail
import { useRef } from "react";

export const SharedEntries = () => {
  const entries = useRef(new Map());
  return ["earlier", "later"].map((entryKey) => (
    <section
      key={entryKey}
      ref={(node) => {
        if (node) {
          entries.current.set("shared", node);
          return () => {
            if (entries.current.get("shared") === node) entries.current.delete("shared");
          };
        } else entries.current.delete("shared");
      }}
    />
  ));
};
