// rule: no-derived-state-effect
// weakness: control-flow
// verdict: pass
import { useState, useEffect } from "react";
export const Popup = ({ expanded }) => {
  const [open, setOpen] = useState(false);
  const closePopup = () => setOpen(false);
  const dismiss = () => closePopup();
  useEffect(() => {
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [dismiss]);
  useEffect(() => setOpen(expanded), [expanded]);
  return <section>{open ? "shown" : "hidden"}</section>;
};
