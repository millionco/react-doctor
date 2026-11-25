import { useCallback, useEffect, useRef, useState } from "react";

export const Picker = ({ expanded }: { expanded: boolean }) => {
  const [selection, setSelection] = useState(-1);
  const fieldRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useCallback(() => {
    const field = fieldRef.current;
    if (field) {
      field.focus();
      setSelection(-1);
    }
  }, []);

  useEffect(() => {
    if (expanded) restoreFocus();
  }, [expanded, restoreFocus]);

  return (
    <>
      <input ref={fieldRef} />
      <button onClick={() => setSelection(1)}>{selection}</button>
    </>
  );
};
