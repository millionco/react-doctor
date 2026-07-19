// rule: no-mutate-queried-dom-node-in-component
// weakness: alias-guard
// source: deep audit of millionco/react-doctor#1000

import { useEffect as useBrowserEffect } from "react";

export const Row = ({ opacity }: { opacity: number }) => {
  useBrowserEffect(() => {
    return () => {
      const row = document.getElementById("row");
      if (row) row.style.opacity = "";
    };
  }, []);
  return <div id="row" style={{ opacity }} />;
};
