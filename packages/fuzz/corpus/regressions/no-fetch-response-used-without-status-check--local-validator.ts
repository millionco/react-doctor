// rule: no-fetch-response-used-without-status-check
// verdict: pass
// weakness: wrapper-transparency
// source: ReactBench semantic false positive
const responseSucceeded = (response: Response): boolean => {
  if (typeof response.ok === "boolean") return response.ok;
  return typeof response.status !== "number" || (response.status >= 200 && response.status < 300);
};

export const load = async (): Promise<unknown> => {
  const response = await fetch("/api/keys");
  if (!responseSucceeded(response)) throw new Error("Unable to refresh");
  return response.json();
};
