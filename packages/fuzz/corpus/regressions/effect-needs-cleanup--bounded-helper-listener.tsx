// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic helper lifetime regression
// verdict: fail

import { useEffect } from "react";

const attach = () => {
  document.addEventListener("pointermove", () => {});
};
const prepare = () => {
  attach();
};
export const Panel = () => {
  useEffect(() => {
    prepare();
    return () => {
      console.info("finished");
    };
  }, []);
  return null;
};
