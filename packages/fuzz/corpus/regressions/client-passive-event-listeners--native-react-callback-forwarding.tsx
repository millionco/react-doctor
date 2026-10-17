// rule: client-passive-event-listeners
// verdict: pass
// weakness: wrapper-transparency
// source: independent synthetic React callback contract
import React from "react";

export const Panel = () => {
  const handleWheel = React.useCallback((event: WheelEvent) => {
    onMove(event);
  }, []);
  React.useEffect(() => {
    document.addEventListener("wheel", handleWheel);
    return () => document.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);
  return null;
};
