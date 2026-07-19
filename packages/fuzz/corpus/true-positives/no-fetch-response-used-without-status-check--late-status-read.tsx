// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
export const loadItems = async () => {
  const response = await fetch("/api/items");
  const body = await response.json();
  if (!response.ok) throw new Error("failed");
  return body;
};
