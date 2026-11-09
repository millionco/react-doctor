// rule: prefer-module-scope-static-value
// verdict: pass
// weakness: cross-file
// source: independent synthetic imported evaluation control
import readSnapshot from "synthetic-snapshot-provider";

const firstReader = readSnapshot;
const selectedReader = firstReader;

export const useSnapshotOptions = () => {
  const options = { label: selectedReader() };
  return options;
};
