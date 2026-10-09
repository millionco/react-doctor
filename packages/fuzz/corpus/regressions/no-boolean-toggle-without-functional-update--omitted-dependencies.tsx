// rule: no-boolean-toggle-without-functional-update
// verdict: fail
// weakness: omitted effect dependencies crashed cleanup analysis
// source: reduced local regression
import { useEffect, useState } from "react";
export const Panel = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setOpen(!open), 100);
    return () => clearInterval(timer);
  });
  return null;
};
