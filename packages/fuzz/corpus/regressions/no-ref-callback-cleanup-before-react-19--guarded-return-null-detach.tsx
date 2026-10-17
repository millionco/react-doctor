// rule: no-ref-callback-cleanup-before-react-19
// weakness: guarded-return-null-detach
// source: independently-synthetic
// verdict: pass
import * as React from "react";
const useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
export const EntryPanel = () => {
  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());
  const entryKey = "entry";
  useBrowserEffect(() => {
    entries.current.get(entryKey)?.focus();
  }, [entryKey]);
  return (
    <li
      ref={(element) => {
        if (element) {
          entries.current.set(entryKey, element);
          return () => {
            if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);
          };
        } else {
          entries.current.delete(entryKey);
        }
      }}
    >
      Entry
    </li>
  );
};
