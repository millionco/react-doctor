// rule: no-non-null-assertion-on-maybe-undefined-result
// verdict: fail
// weakness: control-flow
// source: synthetic mismatched native Map key

export const readOtherLabel = (items: readonly { group: string; label: string }[]) => {
  const groups = new Map<string, { group: string; label: string }>();
  items.forEach((item) => groups.set(item.group, item));
  return groups.get("selected") ? groups.get("other")!.label : undefined;
};
