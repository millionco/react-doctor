import { useCallback, useEffect, useRef, useState } from "react";

const selectPanelAction = ({ heading, action }) => ({ heading, action });

export const SearchPanel = ({ heading }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const focus = useCallback(() => inputRef.current?.focus(), []);
  const { action } = selectPanelAction({ heading, action: focus });
  useEffect(() => {
    setExpanded(true);
    action();
  }, [action]);
  return <input ref={inputRef} aria-label={heading} aria-expanded={expanded} />;
};
