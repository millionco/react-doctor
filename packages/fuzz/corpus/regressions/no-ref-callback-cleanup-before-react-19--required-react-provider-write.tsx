// rule: no-ref-callback-cleanup-before-react-19
// verdict: fail
// weakness: alias-guard
// source: independently-synthetic callback Map proof review
import * as React from "react";
require("react").useRef = () => ({ current: new Map() });
interface PanelProps {
  onInspect?: (value: unknown) => void;
  attributes?: React.HTMLAttributes<HTMLLIElement>;
}
export const EntryPanel = ({ onInspect, attributes }: PanelProps) => {
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
