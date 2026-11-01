// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: alias-guard
// source: synthetic regression
import { useState } from "react";
export const Preview = ({ URL }) => {
  const [preview, setPreview] = useState("");
  const clear = () =>
    setPreview((previous) => {
      URL.revokeObjectURL(previous);
      return "";
    });
  return <button onClick={clear}>{preview}</button>;
};
