// rule: client-passive-event-listeners
// verdict: fail
// weakness: wrapper-transparency
// source: independent synthetic React callback contract
import React from "react";

export const Panel = () => {
  const handleWheel = React.useCallback((event: WheelEvent) => {
    console.info(event.deltaY);
  }, []);
  React.useEffect(() => {
    document.addEventListener("wheel", handleWheel);
    return () => document.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);
  return null;
};
