// rule: no-fetch-response-used-without-status-check
// weakness: alias-guard
// source: synthetic native parity regression
export async function load() {
  const response = await fetch("/items");
  if (!response?.ok) throw new Error("failed");
  return response.json();
}
