// no-adjust-state-on-prop-change, control-flow, authored regression
import { useCallback, useEffect, useRef, useState } from "react";

export const SearchBox = ({ open }: { open: boolean }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState(-1);
  const focusAndReset = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      setSelection(-1);
    }
  }, []);
  useEffect(() => {
    if (open) focusAndReset();
  }, [open, focusAndReset]);
  return (
    <>
      <input ref={inputRef} />
      <button onClick={() => setSelection(0)}>{selection}</button>
    </>
  );
};
