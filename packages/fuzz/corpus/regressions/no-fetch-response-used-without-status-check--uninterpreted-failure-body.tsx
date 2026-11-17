// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: independently-authored-public-synthetic
// verdict: fail
export const loadRecord = async () => {
  const response = await fetch("/api/records");
  if (response.ok) return;
  return response.json();
};
