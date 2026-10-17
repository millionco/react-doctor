// rule: prefer-module-scope-static-value
// verdict: fail
// weakness: cross-file
// source: independent synthetic static-allocation positive control

export const StaticOptions = () => {
  const options = { label: "fixed" };
  return <output>{options.label}</output>;
};
