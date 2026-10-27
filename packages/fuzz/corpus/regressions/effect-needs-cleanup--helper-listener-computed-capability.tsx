// rule: effect-needs-cleanup
// weakness: dynamic-computed
// source: synthetic helper lifetime regression
// verdict: pass

import { useEffect } from "react";

const values = ["entry"];
const key = "filter";
const invoke = values[key];
const box = {};
box.handler = invoke;
box.handler();
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
