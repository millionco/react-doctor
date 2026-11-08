// rule: no-fetch-response-used-without-status-check
// verdict: fail
// weakness: control-flow
// source: independently authored synthetic regression
const inspectHttpResponse = (response: Response, payload: Promise<unknown>): void => {
  if (!response.ok) throw new Error("Request failed");
  void payload;
};

export const load = async (): Promise<void> => {
  const response = await fetch("/api/items");
  inspectHttpResponse(response, response.json());
};
