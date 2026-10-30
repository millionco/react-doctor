// rule: no-derived-state
// weakness: control-flow
// verdict: fail
import { useState, useEffect } from "react";
export const Popup = ({ expanded }) => {
  const [open, setOpen] = useState(false);
  const closePopup = () => setOpen(false);
  const _dismiss = () => closePopup();
  useEffect(() => setOpen(expanded), [expanded]);
  return <section>{open ? "shown" : "hidden"}</section>;
};
