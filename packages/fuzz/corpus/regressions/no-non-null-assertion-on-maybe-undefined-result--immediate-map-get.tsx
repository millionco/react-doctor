// rule: no-non-null-assertion-on-maybe-undefined-result
// verdict: pass
// weakness: control-flow
// source: synthetic immediate native Map guard

export const groupLabels = (items: readonly { group: string; label: string }[]) => {
  const groups = new Map<string, string[]>();
  items.forEach((item) => {
    const key = item.group;
    groups.set(key, groups.get(key) ? groups.get(key)!.concat(item.label) : [item.label]);
  });
  return Array.from(groups);
};
