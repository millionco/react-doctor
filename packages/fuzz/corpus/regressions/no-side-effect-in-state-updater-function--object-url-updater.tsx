// rule: no-side-effect-in-state-updater-function
// verdict: fail
// weakness: native-api
// source: synthetic regression
import { useState } from "react";
export const Preview = () => {
  const [preview, setPreview] = useState("");
  const clear = () =>
    setPreview((previous) => {
      URL.revokeObjectURL(previous);
      return "";
    });
  return <button onClick={clear}>{preview}</button>;
};
