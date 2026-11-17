// rule: no-nonresizable-textarea
// weakness: library-idiom
// source: synthetic
// verdict: fail
import { useRef, useState } from "react";

export const NoteInput = () => {
  const [note, setNote] = useState("");
  const input = useRef<HTMLTextAreaElement | null>(null);
  const edit = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNote(event.currentTarget.value);
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = input.current.scrollHeight + "px";
    }
  };
  return (
    <textarea
      ref={input}
      value={note}
      onChange={edit}
      style={{
        resize: "none",
        boxSizing: "border-box",
        border: "20px solid",
        padding: 0,
        overflow: "hidden",
      }}
    />
  );
};
