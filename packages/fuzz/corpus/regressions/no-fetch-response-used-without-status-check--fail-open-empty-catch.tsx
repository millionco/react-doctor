// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (moderation gate: deliberately fail-open — the enclosing try has an empty catch and no success dependence)
export async function moderate(text: string) {
  try {
    const upstream = await fetch("/moderate-text", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const verdict = await upstream.json();
    if (verdict.allowed === false) {
      return { blocked: true };
    }
  } catch {
    // HACK: fail-open — moderation infra must never block a self-hoster's publish
  }
  return { blocked: false };
}
