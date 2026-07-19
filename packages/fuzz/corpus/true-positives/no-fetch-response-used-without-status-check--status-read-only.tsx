// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
export const load = async (debug: boolean) => {
  const response = await fetch("/api");
  if (debug) console.log(response.status);
  return response.json();
};
