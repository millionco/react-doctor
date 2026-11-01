// rule: client-passive-event-listeners
// verdict: fail
// weakness: provider-erasure
// source: synthetic
declare const require: any;
require("react").useCallback = () => () => undefined;
import React from "react";

const Panel = () => {
  const handleWheel = React.useCallback((event: WheelEvent) => {
    event.preventDefault();
  }, []);
  React.useEffect(() => {
    document.addEventListener("wheel", handleWheel);
    return () => document.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);
  return null;
};
