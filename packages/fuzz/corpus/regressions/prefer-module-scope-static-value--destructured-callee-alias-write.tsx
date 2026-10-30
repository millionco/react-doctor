// rule: prefer-module-scope-static-value
// verdict: fail
// weakness: cross-file
// source: independent synthetic imported-call boundary regression
import readSnapshot from "./state-reader";
const selectedReader = readSnapshot;
({ selectedReader } = { selectedReader: () => "replacement" });
export const useSettings = () => {
  const options = { label: selectedReader() };
  return options;
};
