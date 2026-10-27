// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: synthetic helper lifetime regression
// verdict: pass

import { useEffect } from "react";

let active = true;
const attach = () => {
  document.addEventListener("pointermove", () => {
    if (active) console.info("moving");
  });
};
const prepare = () => {
  attach();
};
export const Panel = () => {
  useEffect(() => {
    prepare();
    return () => {
      active = false;
    };
  }, []);
  return null;
};
