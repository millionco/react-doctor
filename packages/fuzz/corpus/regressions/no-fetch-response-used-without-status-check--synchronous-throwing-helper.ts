// rule: no-fetch-response-used-without-status-check
// verdict: pass
// weakness: control-flow
// source: independently authored synthetic regression
const inspectHttpResponse = (response: Response, message = "Request failed"): void => {
  if (!response.ok) {
    if (response.status === 401) throw new Error("Unauthorized");
    throw new Error(message);
  }
};

export const load = async (): Promise<unknown> => {
  const response = await fetch("/api/items");
  inspectHttpResponse(response);
  return response.json();
};
