// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
export const load = async () => {
  const response = await fetch("/api");
  if (response.ok) console.log("ok");
  return response.json();
};

export const loadFailureBody = async () => {
  const response = await fetch("/api");
  if (response.ok) return;
  return response.json();
};
