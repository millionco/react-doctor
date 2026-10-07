// rule: server-sequential-independent-await
// verdict: pass
// Source: issue #1810 and PR #1811 review.
// Weakness: HTTP writes must preserve their sequential order.
export async function update() {
  const first = await fetch("/create", { method: "POST" });
  const second = await fetch("/update", { method: "PATCH" });
  return [first, second];
}
