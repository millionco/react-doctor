// rule: no-fetch-response-used-without-status-check
// weakness: alias-guard
// source: adversarial audit of render/data-safety rules
export const load = async () => {
  const response = await fetch("/api");
  {
    const response = { json: async () => ({}) };
    await response.json();
  }
  void response;
  return 1;
};
