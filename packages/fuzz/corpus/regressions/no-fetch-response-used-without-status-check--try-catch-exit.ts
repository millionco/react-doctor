// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: Synthetic native parity regression
export const loadItems = async () => {
  const response = await fetch("/items");
  const body = await response.json();
  if (!response.ok) {
    try {
      return JSON.stringify(body);
    } catch {
      return "invalid";
    }
  }
  return body;
};
