// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: guard-clause
// source: synthetic native parity regression
const grouped = new Map<string, string[]>();
for (const item of items) {
  if (!grouped.has(item.group)) grouped.set(item.group, []);
  grouped.get(item.group)!.push("value");
}
