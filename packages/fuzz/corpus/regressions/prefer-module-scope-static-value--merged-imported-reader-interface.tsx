// rule: prefer-module-scope-static-value
// verdict: pass
// weakness: cross-file
// source: independent synthetic imported-call boundary regression
import { useState } from "react";
import readSnapshot from "./state-reader";
interface readSnapshot {}
export const useSettings = () => {
  const [enabled] = useState(true);
  const options = { label: readSnapshot() };
  return { options, enabled };
};
