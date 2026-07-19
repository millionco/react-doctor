// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: PR #1402 local Daytona parity

const groupValues = (values: string[], key: string) => {
  const groupedValues = new Map<string, string[]>();
  if (!groupedValues.has(key)) groupedValues.set(key, []);
  groupedValues.get(key)!.push(...values);
  return groupedValues;
};

export { groupValues };
